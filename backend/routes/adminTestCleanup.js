'use strict';
/**
 * Administrator-requested permanent cleanup of explicitly selected test records.
 * No blanket DELETE, no ON DELETE CASCADE and no implicit removal of an ER visit.
 * Preview and execution both recompute the same manifest. Transactional execution
 * checks the supplied manifest digest, performs FK discovery and logs each deletion.
 */
const express = require('express');
const crypto = require('node:crypto');
const pool = require('../db');
const auth = require('../middleware/authMiddleware');
const router = express.Router();
router.use(auth, auth.requireRole('ADMIN'));
const TABLES = Object.freeze({
  pre_er_assessments: 'assessment_id', pre_er_vitals: 'vital_id', ambulance_transports: 'transport_id'
});
const q = s => '"'+String(s).replace(/"/g,'""')+'"';
function parse(body) {
  if (!body || !['users','cases'].includes(body.kind) || !Array.isArray(body.ids) || body.ids.length<1 || body.ids.length>100 || !body.ids.every(n=>Number.isSafeInteger(n)&&n>0&&n<2147483648) || new Set(body.ids).size!==body.ids.length) return null;
  return {kind:body.kind,ids:[...body.ids].sort((a,b)=>a-b)};
}
const signature = manifest => crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
async function fks(client, target){
 const r=await client.query(`SELECT n.nspname AS schema, t.relname AS tbl, a.attname AS col, cardinality(c.conkey) AS cols
 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1]
 WHERE c.contype='f' AND c.confrelid=$1::regclass`,[target]);
 return r.rows;
}
async function manifest(client,kind,ids,actor){
 const blockers=[];let users=[], cases=[];
 if(kind==='users'){
  users=(await client.query(`SELECT user_id,username,role,is_active FROM public.users WHERE user_id=ANY($1::integer[]) ORDER BY user_id`,[ids])).rows;
  for(const id of ids) if(!users.some(u=>u.user_id===id))blockers.push(`User #${id} is missing`);
  for(const u of users){
   if(u.role==='ADMIN'||u.user_id===actor)blockers.push(`Administrator ${u.username} cannot be deleted`);
   if(u.role==='PATIENT')blockers.push(`Patient ${u.username} requires a separate consent/identity cleanup process`);
   if(!['DOCTOR','ER_STAFF','PARAMEDIC','ADMIN','PATIENT'].includes(u.role))blockers.push(`Unsupported role for ${u.username}`);
  }
  cases=(await client.query(`SELECT c.case_id,c.temporary_case_code,c.case_status,c.created_by,c.stay_id,c.patient_id,
        u.username AS creator FROM public.emergency_cases c LEFT JOIN public.users u ON u.user_id=c.created_by
        WHERE c.created_by=ANY($1::integer[]) ORDER BY c.case_id`,[ids])).rows;
 } else {
  cases=(await client.query(`SELECT c.case_id,c.temporary_case_code,c.case_status,c.created_by,c.stay_id,c.patient_id,
      u.username AS creator FROM public.emergency_cases c LEFT JOIN public.users u ON u.user_id=c.created_by
      WHERE c.case_id=ANY($1::integer[]) ORDER BY c.case_id`,[ids])).rows;
  for(const id of ids)if(!cases.some(c=>c.case_id===id))blockers.push(`Case #${id} is missing`);
 }
 if(cases.length>1000)blockers.push('More than 1,000 related cases; split into smaller batches');
 // Show all linked visit IDs: preserve the ER visits, their doctors, and patients.
 // A linked visit does not itself make the case ineligible, but the reviewer must
 // explicitly acknowledge this irreversible loss of its pre-hospital handover.
 const caseIds=cases.map(c=>c.case_id);
 const childRows={};
 for(const [table,pk] of Object.entries(TABLES)){
  childRows[table]=caseIds.length?(await client.query(`SELECT ${q(pk)} AS id,case_id FROM public.${q(table)} WHERE case_id=ANY($1::integer[]) ORDER BY ${q(pk)} LIMIT 5001`,[caseIds])).rows:[];
  if(childRows[table].length>5000)blockers.push(`Too many ${table} rows; split into smaller batches`);
 }
 // Never permanently remove a handover, recorded vitals, assessments or
 // transport data from this live database, even after admin confirmation.
 // A test username or a selected manifest is not proof of synthetic data.
 for(const c of cases){
   if(c.stay_id!=null || c.patient_id!=null)
     blockers.push(`Case #${c.case_id} is linked to a patient or ER visit; archive it instead`);
 }
 for(const [table, rows] of Object.entries(childRows)){
   if(rows.length)blockers.push(`Cannot purge ${rows.length} clinical/transport rows in ${table}; preserve the case`);
 }
 // All additional foreign-key relationships must be empty: newly added tables
 // automatically block cleanup rather than being silently cascaded or orphaned.
 for(const dep of await fks(client,'public.emergency_cases')){
  if(dep.cols!==1||!dep.col){blockers.push(`Complex FK in ${dep.tbl}`);continue;}
  if(dep.schema==='public'&&Object.keys(TABLES).includes(dep.tbl)&&dep.col==='case_id')continue;
  if(!caseIds.length)continue;
  const hits=await client.query(`SELECT COUNT(*)::integer AS count FROM ${q(dep.schema)}.${q(dep.tbl)} WHERE ${q(dep.col)}=ANY($1::integer[])`,[caseIds]);
  if(hits.rows[0].count)blockers.push(`${hits.rows[0].count} rows in ${dep.schema}.${dep.tbl} reference the cases`);
 }
 if(kind==='users'){
  const allowed=new Set(['doctor_invitations.user_id','doctor_profiles.user_id','staff_profiles.user_id','admin_password_resets.user_id','emergency_cases.created_by']);
  for(const dep of await fks(client,'public.users')){
   if(dep.cols!==1||!dep.col){blockers.push(`Complex user FK in ${dep.tbl}`);continue;}
   if(dep.schema==='public'&&allowed.has(`${dep.tbl}.${dep.col}`))continue;
   if(dep.schema==='public' && dep.tbl==='pre_er_assessments' && dep.col==='recorded_by'){
    const unmatched=await client.query(`SELECT count(*)::int AS count FROM public.pre_er_assessments WHERE recorded_by=ANY($1::integer[]) AND NOT(case_id=ANY($2::integer[]))`,[ids,caseIds]);
    if(unmatched.rows[0].count)blockers.push(`${unmatched.rows[0].count} assessments outside selected cases reference these users`);
    continue;
   }
   const hits=await client.query(`SELECT COUNT(*)::integer AS count FROM ${q(dep.schema)}.${q(dep.tbl)} WHERE ${q(dep.col)}=ANY($1::integer[])`,[ids]);
   if(hits.rows[0].count)blockers.push(`${hits.rows[0].count} rows in ${dep.schema}.${dep.tbl} reference selected users`);
  }
  // Doctor/staff profile IDs can be referenced instead of users.user_id.
  // Guard those FKs too; an assigned doctor must never disappear from an ER stay.
  for(const target of ['doctor_profiles','staff_profiles']){
   for(const dep of await fks(client,`public.${target}`)){
    if(dep.cols!==1||!dep.col){blockers.push(`Complex ${target} relationship in ${dep.tbl}`);continue;}
    const hits=await client.query(`SELECT count(*)::int AS count FROM ${q(dep.schema)}.${q(dep.tbl)} WHERE ${q(dep.col)}=ANY($1::integer[])`,[ids]);
    if(hits.rows[0].count)blockers.push(`${hits.rows[0].count} rows in ${dep.schema}.${dep.tbl} reference selected ${target}`);
   }
  }
  // All other FK dependencies are checked above; no arbitrary cascades.
 }
 const accountArtifacts={};
 if(kind==='users'){
  for(const table of ['doctor_invitations','doctor_profiles','staff_profiles','admin_password_resets']){
   accountArtifacts[table]=(await client.query(`SELECT user_id,COUNT(*)::int AS n FROM public.${q(table)} WHERE user_id=ANY($1::integer[]) GROUP BY user_id ORDER BY user_id`,[ids])).rows;
  }
 }
 const summary={
  account_artifacts:Object.fromEntries(Object.entries(accountArtifacts).map(([table,rows])=>[table,rows.reduce((n,r)=>n+r.n,0)])),
  users:users.map(u=>({id:u.user_id,username:u.username,role:u.role,active:u.is_active})),
  cases:cases.map(c=>({id:c.case_id,code:c.temporary_case_code,status:c.case_status,created_by:c.created_by,creator:c.creator,stay_id:c.stay_id,patient_id:c.patient_id,
   assessments:childRows.pre_er_assessments.filter(x=>x.case_id===c.case_id).length,
   vitals:childRows.pre_er_vitals.filter(x=>x.case_id===c.case_id).length,
   transports:childRows.ambulance_transports.filter(x=>x.case_id===c.case_id).length})),
  preserved_er_visits:[...new Set(cases.map(c=>c.stay_id).filter(Boolean).map(String))].sort(),
  preserved_patient_ids:[...new Set(cases.map(c=>c.patient_id).filter(Boolean).map(String))].sort(),
  child_counts:Object.fromEntries(Object.entries(childRows).map(([key,rows])=>[key,rows.length])),
  // Includes explicit chosen IDs to prevent preview reuse with a different batch.
  kind,selected_ids:ids
 };
 return {summary,blockers,digest:signature({summary,child_ids:Object.fromEntries(Object.entries(childRows).map(([table,rows])=>[table,rows.map(r=>r.id)])),account_artifacts:accountArtifacts})};
}
router.post('/preview',async(req,res)=>{
 const args=parse(req.body);if(!args)return res.status(400).json({error:'Select 1 to 100 unique account or case IDs'});
 try{const plan=await manifest(pool,args.kind,args.ids,req.user.user_id);res.json({...plan,eligible:plan.blockers.length===0});}
 catch(e){console.error('Test cleanup preview:',e.code||e.message);res.status(500).json({error:'Unable to inspect dependencies'});}
});
router.post('/execute',async(req,res)=>{
 const args=parse(req.body),reason=req.body?.reason,verification=req.body?.verification,digest=req.body?.digest;
 if(!args||typeof reason!=='string'||reason.trim().length<12||reason.length>500||verification!=='DELETE VERIFIED TEST DATA'||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))
  return res.status(400).json({error:'A selection, reason (12-500 characters), preview digest and exact confirmation are required'});
 const client=await pool.connect();let tx=false;
 try{
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');tx=true;
  // Cooperate with other cleanup requests; regular application writers still
  // rely on FK enforcement. Any concurrent mutation aborts the whole action.
  await client.query('SELECT pg_advisory_xact_lock($1)',[824601]);
  const plan=await manifest(client,args.kind,args.ids,req.user.user_id);
  if(plan.blockers.length||plan.digest!==digest){await client.query('ROLLBACK');tx=false;return res.status(409).json({error:'Cleanup selection or related records changed; preview again. Nothing deleted.',blockers:plan.blockers});}
  const caseIds=plan.summary.cases.map(c=>c.id);
  if(caseIds.length){
   for(const table of Object.keys(TABLES))await client.query(`DELETE FROM public.${q(table)} WHERE case_id=ANY($1::integer[])`,[caseIds]);
   await client.query('DELETE FROM public.emergency_cases WHERE case_id=ANY($1::integer[])',[caseIds]);
  }
  if(args.kind==='users'){
   for(const table of ['admin_password_resets','doctor_invitations','doctor_profiles','staff_profiles'])await client.query(`DELETE FROM public.${q(table)} WHERE user_id=ANY($1::integer[])`,[args.ids]);
   await client.query('DELETE FROM public.users WHERE user_id=ANY($1::integer[])',[args.ids]);
  }
  // Audit evidence is retained; do not log full patient identifiers or payloads.
  const auditDescription=JSON.stringify({users:plan.summary.users.map(u=>({id:u.id,name:u.username})),cases:plan.summary.cases.map(c=>({id:c.id,code:c.code,linked_stay:c.stay_id})),child_counts:plan.summary.child_counts,account_artifacts:plan.summary.account_artifacts,preserved_er_visits:plan.summary.preserved_er_visits});
  await client.query(`INSERT INTO public.admin_action_audit(actor_user_id,action,target_type,target_id,reason)
      VALUES($1,'VERIFIED_TEST_DATA_PURGE',$2,$3,$4)`,[req.user.user_id,args.kind.toUpperCase(),digest,`${reason.trim()} | manifest=${digest} | ${auditDescription}`.slice(0,20000)]);
  await client.query('COMMIT');tx=false;
  return res.json({deleted_users:plan.summary.users.length,deleted_cases:caseIds.length,deleted_child_rows:plan.summary.child_counts,preserved_er_visits:plan.summary.preserved_er_visits,
   message:'Selected test records deleted. Linked ER visits and patient records were preserved.'});
 }catch(e){if(tx)await client.query('ROLLBACK').catch(()=>{});console.error('Test cleanup execution:',e.code||e.message);
  return res.status(e.code==='23503'||e.code==='40001'?409:500).json({error:'Cleanup was rolled back. Related data changed or protected dependencies remain. Preview again; nothing was deleted.'});
 }finally{client.release();}
});
module.exports=router;
