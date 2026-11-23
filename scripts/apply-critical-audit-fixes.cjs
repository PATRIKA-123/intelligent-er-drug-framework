'use strict';
// Apply audited changes against the 2026-11-23 frontendfix source revision.
// Strict match counts: abort before writing anything if source differs.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const edits = [];
function stage(file, changes) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`Missing: ${file}`);
  const original = fs.readFileSync(full, 'utf8');
  // Git for Windows may check out files with CRLF endings; source patterns
  // in the patch are LF. Normalize only for comparison, then restore endings.
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original.replace(/\r\n?/g, '\n');
  for (const [from, to, label] of changes) {
    const hits = text.split(from).length - 1;
    if (hits !== 1) throw new Error(`${file}: expected one ${label}, found ${hits}; no files modified. Check branch/version.`);
    text = text.replace(from, to);
  }
  edits.push([full, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, file]);
}

stage('backend/db.js', [
  ['{ rejectUnauthorized: false }', '{ rejectUnauthorized: true }', 'PostgreSQL certificate verification']
]);
stage('backend/config/validateEnvironment.js', [
  ['  if (env.DB_SSL !== undefined && !["true", "false"].includes(env.DB_SSL)) {\n    errors.push("DB_SSL must be true or false");\n  }',
   '  if (env.DB_SSL !== undefined && !["true", "false"].includes(env.DB_SSL)) {\n    errors.push("DB_SSL must be true or false");\n  }\n  if (env.NODE_ENV === "production" && env.DB_SSL !== "true") {\n    errors.push("DB_SSL must be true in production");\n  }',
   'production TLS policy']
]);

stage('backend/services/accessPolicy.js', [
  [
`  if (user.role === "ER_STAFF") {
    const statuses = options.postEr
      ? [...LIVE_ER_STATUSES, "CLOSED"]
      : LIVE_ER_STATUSES;
    const r = await pool.query(
      \`SELECT 1 FROM emergency_cases
       WHERE stay_id = $1 AND case_status = ANY($2)
       LIMIT 1\`,
      [stayId, statuses]
    );
    return r.rowCount > 0;
  }`,
`  if (user.role === "ER_STAFF") {
    // A walk-in ER visit may have no emergency_cases row. ER staff have
    // hospital-wide stay access; role authentication is checked by the guard.
    const r = await pool.query(
      'SELECT 1 FROM public.ed_stays WHERE stay_id = $1 LIMIT 1',
      [stayId]
    );
    return r.rowCount > 0;
  }`,
   'walk-in stay read rule'
  ],
  [
`    case "ER_STAFF":
      return {
        clause: \`s.stay_id IN (
                   SELECT stay_id FROM emergency_cases
                   WHERE case_status = ANY($1) AND stay_id IS NOT NULL)\`,
        params: [LIVE_ER_STATUSES],
      };`,
`    case "ER_STAFF":
      // Board and visit listings must include direct walk-in registrations.
      // Other endpoints must still enforce the user's ER_STAFF role.
      return { clause: "TRUE", params: [] };`,
   'walk-in stay list scope'
  ]
]);

stage('backend/routes/round2Vitals.js', [
  [ 'function parseBody(raw){', 'function parseBody(raw, clinicianAuthorized=false){', 'parseBody authorization parameter' ],
  [ 'scale2ClinicianAuthorized:raw.scale2_clinician_authorized===true', 'scale2ClinicianAuthorized:clinicianAuthorized===true', 'remove client authorization flag' ],
  [
` let result;try{result=parseBody(req.body);}catch(e){return res.status(400).json({error:e.message,code:'VALIDATION_ERROR'});}`,
` // Scale 2 cannot be authorized by a client-provided boolean. It requires
 // a currently active, assigned DOCTOR with an unrevoked permission grant.
 let clinicianAuthorized=false;
 if(req.body?.spo2_scale===2){
   if(req.user.role!=='DOCTOR')return res.status(403).json({error:'Scale 2 requires the assigned clinician to record this observation'});
   try{
     const permission=await pool.query(\`SELECT 1 FROM public.user_clinical_permissions perm
       JOIN public.users u ON u.user_id=perm.user_id
       JOIN public.stay_doctor_assignments a ON a.doctor_user_id=u.user_id
       WHERE perm.user_id=$1 AND perm.permission_code='NEWS2_SPO2_SCALE_2'
         AND perm.revoked_at IS NULL
         AND u.role='DOCTOR' AND u.is_active=TRUE AND u.archived_at IS NULL
         AND a.stay_id=$2 AND a.status='ACTIVE' AND a.ended_at IS NULL
       LIMIT 1\`,[req.user.user_id,stayId]);
     clinicianAuthorized=permission.rowCount>0;
   }catch(e){console.error('Scale 2 authorization lookup:',e.code||'DB_ERROR');return res.status(503).json({error:'Unable to verify Scale 2 clinical authorization'});}
   if(!clinicianAuthorized)return res.status(403).json({error:'Assigned doctor lacks active Scale 2 authorization'});
 }
 let result;try{result=parseBody(req.body,clinicianAuthorized);}catch(e){return res.status(400).json({error:e.message,code:'VALIDATION_ERROR'});}`,
   'server-side Scale 2 authorization gate'
  ]
]);

stage('backend/routes/adminManagement.js', [
 [
"const auth = require('../middleware/authMiddleware');",
"const auth = require('../middleware/authMiddleware');\nconst rateLimit = require('../middleware/rateLimit');",
'add password-reset throttle dependency'
 ],
 [
"publicRouter.post('/validate-reset',async(req,res)=>{",
"publicRouter.post('/validate-reset',rateLimit({windowMs:15*60*1000,max:20}),async(req,res)=>{",
'rate limit reset token validation'
 ],
 [
"publicRouter.post('/complete-reset',async(req,res)=>{",
"publicRouter.post('/complete-reset',rateLimit({windowMs:15*60*1000,max:8}),async(req,res)=>{",
'rate limit password reset completion'
 ],
 [
"  const hash=await bcrypt.hash(password,10);\n  const c=await pool.connect();",
"  // Do not perform expensive bcrypt hashing for invalid/expired token requests.\n  const c=await pool.connect();",
'avoid unauthenticated bcrypt DoS'
 ],
 [
"    const item=r.rows[0];\n    await c.query('UPDATE users SET password_hash=$2 WHERE user_id=$1',[item.user_id,hash]);",
"    const item=r.rows[0];\n    const hash=await bcrypt.hash(password,10);\n    await c.query('UPDATE users SET password_hash=$2 WHERE user_id=$1',[item.user_id,hash]);",
'hash only after validating token'
 ]
]);

stage('backend/routes/clinicalPermissions.js', [
 [
`       WHERE user_id = $1
         AND is_active = TRUE`,
`       WHERE user_id = $1
         AND role = 'DOCTOR'
         AND is_active = TRUE
         AND archived_at IS NULL`,
  'restrict Scale 2 grant to active doctors'
 ]
]);

stage('backend/routes/adminTestCleanup.js', [
 [
` // All additional foreign-key relationships must be empty: newly added tables`,
` // Never permanently remove a handover, recorded vitals, assessments or
 // transport data from this live database, even after admin confirmation.
 // A test username or a selected manifest is not proof of synthetic data.
 for(const c of cases){
   if(c.stay_id!=null || c.patient_id!=null)
     blockers.push(\`Case #\${c.case_id} is linked to a patient or ER visit; archive it instead\`);
 }
 for(const [table, rows] of Object.entries(childRows)){
   if(rows.length)blockers.push(\`Cannot purge \${rows.length} clinical/transport rows in \${table}; preserve the case\`);
 }
 // All additional foreign-key relationships must be empty: newly added tables`,
 'protected clinical deletion gate'
 ]
]);

stage('.github/workflows/backend-offline.yml', [
 [
'    branches: [main]',
'    branches: [main, frontendfix]',
'backend CI branch coverage'
 ],
 [
'      - run: npm test',
'      - run: npm test\n      - run: node ../scripts/verify-critical-audit-fixes.cjs',
'backend security regression CI step'
 ]
]);

stage('frontend/src/api/index.js', [
 [
'export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? "true") === "true";',
'// Production may never silently fall back to synthetic/mock patient data.\nexport const USE_MOCK = import.meta.env.DEV && String(import.meta.env.VITE_USE_MOCK ?? "false") === "true";',
'production mock-data guard'
 ]
]);
stage('frontend/.env.example', [
 ['VITE_USE_MOCK=true','VITE_USE_MOCK=false','production-ready mock default']
]);

// Stage and validate every change before writing any of them.
for(const [full, content] of edits) {
 if (!content.trim()) throw new Error(`Empty output for ${full}`);
}
for(const [full, content, file] of edits){fs.writeFileSync(full,content);console.log('PATCHED:',file);}
console.log(`Finished: ${edits.length} files patched. Run frontend build, lint and backend tests.`);
