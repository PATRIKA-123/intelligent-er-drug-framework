'use strict';
/** Round 2 disposable LOCAL integration acceptance, intentionally creates only synthetic records. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const fail=s=>{throw Error(s)};
const envFile=path.join(root,'backend','.env.pre-er-test');
const pg=require(path.join(root,'backend','node_modules','pg'));
const dotenv=require(path.join(root,'backend','node_modules','dotenv'));
const jwt=require(path.join(root,'backend','node_modules','jsonwebtoken'));
const assert=require('node:assert/strict');
const results=[], warnings=[];
const record=(name,ok,detail='')=>{results.push({name,result:ok?'PASS':'FAIL',detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' — '+detail:''}`)};
async function test(name,fn){try{await fn();record(name,true)}catch(e){record(name,false,String(e.message||e).slice(0,220))}}
function guard(){
 if(process.argv.length>2 || process.env.ROUND2_E2E_DISPOSABLE!=='YES'||process.env.ROUND2_STAGING_DB_NAME!=='intelligent_er_drug_test') fail('Set ROUND2_E2E_DISPOSABLE=YES and ROUND2_STAGING_DB_NAME=intelligent_er_drug_test. No other arguments supported.');
 if(!fs.existsSync(envFile))fail('Missing backend/.env.pre-er-test');
 const vars=dotenv.parse(fs.readFileSync(envFile));
 if(vars.DB_NAME!=='intelligent_er_drug_test'||!['localhost','127.0.0.1','::1'].includes(vars.DB_HOST))fail('Refusing non-local or non-test DB target in backend/.env.pre-er-test');
 if(!vars.DB_PASSWORD||!vars.DB_USER||!vars.JWT_SECRET)fail('Test env requires DB_PASSWORD, DB_USER, JWT_SECRET');
 if(process.env.DATABASE_URL)fail('Unset DATABASE_URL first; ambiguous DB target');
 return vars;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise((res,rej)=>{s.once('error',rej);s.listen(0,'127.0.0.1',res)});const p=s.address().port;await new Promise(r=>s.close(r));return p}
async function main(){
 const e=guard(), conn={host:e.DB_HOST,port:Number(e.DB_PORT||5432),database:e.DB_NAME,user:e.DB_USER,password:e.DB_PASSWORD};
 const pool=new pg.Pool(conn);let server=null, log='';
 const suffix=crypto.randomBytes(5).toString('hex');const prefix='F_E2E_'+suffix;
 const users={};let stay=null, patientId=null,caseId=null, code=null,reviewId=null;
 const jwtFor=role=>jwt.sign({user_id:users[role],role},e.JWT_SECRET,{expiresIn:'10m'});
 const request=async(method,url,role,body,headers={})=>{
  const h={...headers};if(role)h.Authorization='Bearer '+jwtFor(role);
  if(body!==undefined)h['Content-Type']='application/json';
  const rsp=await fetch(`http://127.0.0.1:${portNumber}/api${url}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  let json=null;try{json=await rsp.json()}catch{}return {status:rsp.status,json};
 };
 let portNumber;
 const must=(r,status,context)=>assert.equal(r.status,status,`${context} expected ${status}, got ${r.status}: ${JSON.stringify(r.json||{}).slice(0,160)}`);
 try{
  const inspect=await pool.query('SELECT current_database() AS database, current_setting(\'transaction_read_only\') AS read_only');
  assert.equal(inspect.rows[0].database,'intelligent_er_drug_test');
  await pool.query('SELECT user_id FROM public.users LIMIT 1');
  console.log('ROUND2_E2E_LOCAL_TARGET_VERIFIED',JSON.stringify({database:inspect.rows[0].database,host:e.DB_HOST,synthetic_prefix:prefix}));
  // Dedicated staff fixtures. All account credentials are random and are never printed.
  for(const role of ['ADMIN','ER_STAFF','DOCTOR','PARAMEDIC']){
   const username=`${prefix}_${role.toLowerCase()}`;
   const u=await pool.query('INSERT INTO public.users(username,email,password_hash,role,is_active) VALUES($1,NULL,$2,$3,TRUE) RETURNING user_id',[username,crypto.randomBytes(24).toString('hex'),role]);
   users[role]=u.rows[0].user_id;
  }
  portNumber=await port();
  const spawnEnv={...process.env,PRE_ER_TEST_ENV_FILE:envFile,DB_HOST:e.DB_HOST,DB_PORT:e.DB_PORT,DB_NAME:e.DB_NAME,DB_USER:e.DB_USER,DB_PASSWORD:e.DB_PASSWORD,JWT_SECRET:e.JWT_SECRET,PORT:String(portNumber)};
  delete spawnEnv.DATABASE_URL;
  server=cp.spawn(process.execPath,['server.js'],{cwd:path.join(root,'backend'),env:spawnEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});
  server.stdout.on('data',d=>log+=d.toString().slice(-1000));server.stderr.on('data',d=>log+=d.toString().slice(-1500));
  let ready=false;
  for(let i=0;i<45;i++){if(server.exitCode!==null)break;try{const x=await request('GET','/health');if(x.status===200){ready=true;break}}catch{}await wait(200)}
  if(!ready)fail('Backend did not pass /api/health on local test port. Check backend startup and dependencies. Log tail: '+log.slice(-850));
  console.log('ROUND2_E2E_BACKEND_READY',JSON.stringify({port:portNumber}));
  await test('Anonymous patient data blocked',async()=>must(await request('GET','/stays'),401,'anonymous stay list'));
  await test('Paramedic creates a synthetic Pre-ER case',async()=>{
   const r=await request('POST','/emergency-cases','PARAMEDIC',{temporary_case_code:'FE2E'+suffix,source:'APPLICATION'});must(r,201,'Pre-ER create');caseId=r.json?.case?.case_id;assert.ok(caseId);
  });
  await test('ER staff registers visit and links case',async()=>{
   const r=await request('POST','/stays','ER_STAFF',{patient:{full_name:prefix+' Synthetic',date_of_birth:'2000-01-01',phone:'9000012345'},case_id:caseId,chiefcomplaint:'Synthetic integration only',acuity:4},{'Idempotency-Key':'F-E2E-'+suffix+'-register'});
   must(r,201,'register');stay=r.json?.stay_id;patientId=r.json?.patient_id;code=r.json?.access_code;assert.ok(stay&&patientId&&code);assert.equal(r.json?.identity_link_status,'PENDING_VERIFICATION');
  });
  await test('Visit registration idempotency returns the same stay',async()=>{
   assert.ok(stay,'prior registration failed');const r=await request('POST','/stays','ER_STAFF',{patient:{full_name:prefix+' Synthetic',date_of_birth:'2000-01-01',phone:'9000012345'},case_id:caseId,chiefcomplaint:'Synthetic integration only',acuity:4},{'Idempotency-Key':'F-E2E-'+suffix+'-register'});must(r,200,'replay');assert.equal(String(r.json?.stay_id),String(stay));
  });
  await test('Patient signup creates separate, unlinked profile',async()=>{
   const r=await request('POST','/patient/register',null,{full_name:prefix+' Portal',dob:'2000-01-01',phone:'9000087654',email:`${suffix}@example.invalid`,password:crypto.randomBytes(20).toString('hex'),share:false});must(r,201,'patient signup');
   const q=await pool.query('SELECT user_id FROM public.users WHERE username=$1',[`${suffix}@example.invalid`]);users.PATIENT=q.rows[0]?.user_id;assert.ok(users.PATIENT);
  });
  await test('Second independent patient profile is created',async()=>{
   const r=await request('POST','/patient/register',null,{full_name:prefix+' Other',dob:'2001-01-01',phone:'9000089999',email:`${suffix}other@example.invalid`,password:crypto.randomBytes(20).toString('hex'),share:false});must(r,201,'second signup');const q=await pool.query('SELECT user_id FROM users WHERE username=$1',[`${suffix}other@example.invalid`]);users.OTHER=q.rows[0].user_id;
  });
  await test('Patient cannot create paramedic case',async()=>{
   const r=await request('POST','/emergency-cases','PATIENT',{temporary_case_code:'BAD'+suffix});must(r,403,'patient must be denied');
  });
  await test('Patient has no visit before verification',async()=>{
   const r=await request('GET','/patient/me','PATIENT');must(r,200,'patient profile');assert.equal(r.json?.visits?.length,0);
  });
  await test('Patient claim is pending, not auto-approved',async()=>{
   assert.ok(stay&&code,'registration fixture missing');const r=await request('POST','/patient/claim-visit','PATIENT',{stay_id:stay,access_code:code,phone_last4:'2345'});must(r,202,'claim');assert.equal(r.json?.status,'PENDING_VERIFICATION');reviewId=r.json?.review_id;assert.ok(reviewId);const q=await pool.query('SELECT 1 FROM patient_visit_access WHERE stay_id=$1',[stay]);assert.equal(q.rowCount,0);
  });
  await test('Another patient cannot see unowned ER visit',async()=>{
   assert.ok(stay,'missing stay');const r=await request('GET',`/stays/${stay}`,'OTHER');assert.ok([403,404].includes(r.status),`patient accessed visit: HTTP ${r.status}`);
  });
  await test('Patient cannot approve identity review',async()=>{
   assert.ok(reviewId);const r=await request('POST',`/admin/identity-reviews/${reviewId}/decision`,'PATIENT',{decision:'APPROVED',verification_method:'Synthetic in-person confirmation',reason:'Synthetic E2E'});must(r,403,'patient impersonation');
  });
  await test('Admin approves independently verified claim',async()=>{
   assert.ok(reviewId);const r=await request('POST',`/admin/identity-reviews/${reviewId}/decision`,'ADMIN',{decision:'APPROVED',verification_method:'Synthetic E2E independent verification',reason:'Synthetic test only'});must(r,200,'admin approval');assert.equal(r.json?.status,'APPROVED');
  });
  await test('Approved patient can now see assigned visit',async()=>{
   const r=await request('GET','/patient/me','PATIENT');must(r,200,'approved profile');assert.ok(r.json?.visits?.some(v=>String(v.stay_id)===String(stay)));
  });
  await test('Unowned patient has no access after approval',async()=>{
   const r=await request('GET','/patient/me','OTHER');must(r,200,'other profile');assert.ok(!r.json?.visits?.some(v=>String(v.stay_id)===String(stay)));
  });
  await test('Patient can record patient-reported allergy',async()=>{
   const r=await request('POST','/patient/allergies','PATIENT',{name:'Synthetic test allergen',reaction:'Synthetic test only'});must(r,201,'allergy');assert.equal(r.json?.provenance,'PATIENT_REPORTED_UNVERIFIED');
  });
  await test('Consent off hides patient-reported history from admin',async()=>{
   const r=await request('GET',`/stays/${stay}/patient-history`,'ADMIN');must(r,200,'consent off');assert.equal(r.json?.shared,false);assert.ok(!r.json?.reported_allergies);
  });
  await test('Consent on enables admin history with provenance',async()=>{
   must(await request('PATCH','/patient/profile','PATIENT',{share:true}),200,'consent on');const r=await request('GET',`/stays/${stay}/patient-history`,'ADMIN');must(r,200,'shared history');assert.equal(r.json?.shared,true);assert.equal(r.json?.patient_reported_provenance,'PATIENT_REPORTED_UNVERIFIED');
  });
  await test('Revoking consent immediately hides history',async()=>{
   must(await request('PATCH','/patient/profile','PATIENT',{share:false}),200,'consent off');const r=await request('GET',`/stays/${stay}/patient-history`,'ADMIN');must(r,200,'revoked history');assert.equal(r.json?.shared,false);
  });
  await test('Unauthorized doctor cannot read unassigned patient history',async()=>{
   assert.ok(stay);const r=await request('GET',`/stays/${stay}/patient-history`,'DOCTOR');assert.ok([403,404].includes(r.status),`unassigned doctor accessed history: HTTP ${r.status}`);
  });
  await test('Admin identity correction requires independent review',async()=>{
   assert.ok(stay&&users.OTHER);const r=await request('POST','/admin/identity-corrections','ADMIN',{stay_id:stay,target_user_id:users.OTHER,reason:'Synthetic test of correction workflow'});must(r,202,'correction request');assert.equal(r.json?.status,'PENDING_VERIFICATION');const q=await pool.query('SELECT user_id FROM patient_visit_access WHERE stay_id=$1',[stay]);assert.equal(String(q.rows[0]?.user_id),String(users.PATIENT));
   const rid=r.json?.review_id;assert.ok(rid);
   const decision=await request('POST',`/admin/identity-reviews/${rid}/decision`,'ADMIN',{decision:'APPROVED',verification_method:'Synthetic separate manual verification',reason:'Synthetic correction acceptance'});must(decision,200,'approve correction');
   const after=await pool.query('SELECT user_id FROM patient_visit_access WHERE stay_id=$1',[stay]);assert.equal(String(after.rows[0]?.user_id),String(users.OTHER));
  });
  await test('Corrected visit disappears from previous patient',async()=>{
   const r=await request('GET','/patient/me','PATIENT');must(r,200,'previous owner');assert.ok(!r.json?.visits?.some(v=>String(v.stay_id)===String(stay)));
  });
  await test('Correction transfers visit to verified new owner',async()=>{
   const r=await request('GET','/patient/me','OTHER');must(r,200,'new owner');assert.ok(r.json?.visits?.some(v=>String(v.stay_id)===String(stay)));
  });
  await test('Admin rejects independent claim without granting visit',async()=>{
   const r=await request('POST','/stays','ER_STAFF',{patient:{full_name:prefix+' Rejection Case',date_of_birth:'2000-01-01',phone:'9000012345'},chiefcomplaint:'Synthetic rejection only',acuity:5},{'Idempotency-Key':'F-E2E-'+suffix+'-rejection'});must(r,201,'second visit');
   const sid=r.json?.stay_id;assert.ok(sid);
   const claim=await request('POST','/patient/claim-visit','PATIENT',{stay_id:sid,access_code:r.json.access_code,phone_last4:'2345'});must(claim,202,'rejection request');assert.ok(claim.json?.review_id);
   const denial=await request('POST',`/admin/identity-reviews/${claim.json.review_id}/decision`,'ADMIN',{decision:'REJECTED',verification_method:'Synthetic independent review',reason:'Synthetic rejection acceptance'});must(denial,200,'deny claim');
   const owner=await pool.query('SELECT 1 FROM patient_visit_access WHERE stay_id=$1',[sid]);assert.equal(owner.rowCount,0);
  });
  await test('Admin-only review queue blocks ER staff',async()=>must(await request('GET','/admin/identity-reviews','ER_STAFF'),403,'review queue'));
  await test('Doctor may read assigned-role queue endpoint',async()=>must(await request('GET','/post-er/prescriptions','DOCTOR'),200,'prescription queue'));
  await test('Paramedic may not access doctor prescription queue',async()=>must(await request('GET','/post-er/prescriptions','PARAMEDIC'),403,'prescription queue'));
  await test('Admin may read ER board',async()=>must(await request('GET','/stays?limit=1','ADMIN'),200,'ER board'));
  await test('Paramedic may not read ER board',async()=>must(await request('GET','/stays?limit=1','PARAMEDIC'),403,'ER board'));
  await test('ER staff cannot mark departure without discharge',async()=>{
   assert.ok(stay);const r=await request('POST',`/stays/${stay}/departure`,'ER_STAFF',{});assert.ok([403,409].includes(r.status),`unapproved departure accepted: HTTP ${r.status}`);const q=await pool.query('SELECT departed_at FROM ed_stays WHERE stay_id=$1',[stay]);assert.equal(q.rows[0].departed_at,null);
  });
  await test('ER staff records partial vitals without fabricated NEWS2',async()=>{
   assert.ok(stay);const r=await request('POST',`/stays/${stay}/observations`,'ER_STAFF',{heart_rate:88});must(r,201,'partial vitals');assert.equal(r.json?.processing?.status,'PENDING_INPUTS');assert.equal(r.json?.news2,null);
  });
  await test('Patient cannot record hospital observations',async()=>{
   assert.ok(stay);must(await request('POST',`/stays/${stay}/observations`,'PATIENT',{heart_rate:88}),403,'patient vitals');
  });
  await test('Identity and consent audit trail is present',async()=>{
   const r=await pool.query('SELECT action FROM patient_identity_audit WHERE stay_id=$1',[stay]);const actions=r.rows.map(x=>x.action);assert.ok(actions.includes('CLAIM_APPROVED'));assert.ok(actions.some(s=>s.startsWith('HISTORY_')));
  });
  // Explicitly label gaps: no artificial pass for clinical signoff or discharge policy.
  warnings.push('Clinical NEWS2 Scale 2 authorization, prescription approval and discharge clinical policy require human signoff.');
  warnings.push('Full ambulance transport, doctor assignment and prescription authorization require fixture-specific acceptance; not silently marked passed.');
  warnings.push('This is API acceptance, not browser automation and not a clinical approval.');
 } finally {
  if(server){server.kill();await wait(250);if(server.exitCode===null)server.kill('SIGKILL')}
  await pool.end();
  console.log('ROUND2_E2E_RESULTS',JSON.stringify({database:'intelligent_er_drug_test',synthetic_prefix:prefix,total:results.length,passed:results.filter(r=>r.result==='PASS').length,failed:results.filter(r=>r.result==='FAIL').length,results,warnings},null,2));
 }
 if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
}
main().catch(err=>{console.error('ROUND2_E2E_BLOCKED:',String(err.message||err).slice(0,1400));process.exitCode=1});
