'use strict';
// Administrative cleanup is deliberately conservative: NO cascade deletion of medical records.
// Every candidate is re-checked in the same transaction as its deletion.
const express = require('express');
const pool = require('../db');
const auth = require('../middleware/authMiddleware');
const router = express.Router();
router.use(auth, auth.requireRole('ADMIN'));
const positive = x => Number.isSafeInteger(x) && x > 0 && x <= 2147483647;
const parse = body => {
  if (!body || !['users','cases'].includes(body.kind) || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 25 || !body.ids.every(positive)) return null;
  const ids = [...new Set(body.ids)];
  if (ids.length !== body.ids.length) return null;
  return {kind:body.kind,ids};
};
const quote = s => '"' + String(s).replace(/"/g,'""') + '"';
// Discover all *single-column* foreign keys referencing the target PK, including
// tables added later. Multi-column FK is deliberately treated as unsafe in the gate.
async function dependentTables(client, type) {
 const target = type === 'users' ? 'public.users' : 'public.emergency_cases';
 const r = await client.query(`SELECT n.nspname AS schema_name, t.relname AS table_name,
   a.attname AS column_name, cardinality(c.conkey) AS key_count
   FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
   JOIN pg_namespace n ON n.oid=t.relnamespace
   LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1]
   WHERE c.contype='f' AND c.confrelid=$1::regclass`,[target]);
 return r.rows;
}
async function blockedReferences(client, kind, id) {
 const dependencies = await dependentTables(client,kind);
 for(const dep of dependencies) {
  if(Number(dep.key_count)!==1 || !dep.column_name) return 'Complex foreign-key relationship requires manual review';
  // These records belong exclusively to a user and are deleted explicitly below.
  if(kind==='users' && dep.schema_name==='public' && (
   (dep.table_name==='doctor_invitations' && dep.column_name==='user_id') ||
   (dep.table_name==='doctor_profiles' && dep.column_name==='user_id') ||
   (dep.table_name==='staff_profiles' && dep.column_name==='user_id') ||
   (dep.table_name==='admin_password_resets' && dep.column_name==='user_id')
  ))continue;
  const r=await client.query(`SELECT 1 FROM ${quote(dep.schema_name)}.${quote(dep.table_name)} WHERE ${quote(dep.column_name)}=$1 LIMIT 1`,[id]);
  if(r.rowCount)return `Referenced by ${dep.table_name}; preserve related data`;
 }
 return null;
}
async function eligible(client,kind,id,actor,lock=false){
 if(kind==='users'){
  const q=await client.query(`SELECT user_id,username,role,is_active FROM public.users WHERE user_id=$1 ${lock?'FOR UPDATE':''}`,[id]);
  if(!q.rowCount)return {id,eligible:false,reason:'Account not found'};
  const u=q.rows[0];
  if(id===actor)return {id,eligible:false,reason:'You cannot delete your own administrator account',label:u.username};
  if(u.role==='ADMIN')return {id,eligible:false,reason:'Administrator accounts require a separate reviewed recovery process',label:u.username};
  if(u.role==='PATIENT')return {id,eligible:false,reason:'Patient accounts may be linked to clinical records; use deactivation instead',label:u.username};
  if(!['DOCTOR','ER_STAFF','PARAMEDIC'].includes(u.role))return {id,eligible:false,reason:'Role is not supported for deletion',label:u.username};
  const problem=await blockedReferences(client,kind,id);
  return {id,label:`${u.username} (${u.role})`,eligible:!problem,reason:problem||null};
 }
 const q=await client.query(`SELECT case_id,temporary_case_code,case_status,stay_id,patient_id FROM public.emergency_cases WHERE case_id=$1 ${lock?'FOR UPDATE':''}`,[id]);
 if(!q.rowCount)return {id,eligible:false,reason:'Case not found'};
 const c=q.rows[0];
 if(c.case_status!=='PRE_ER'||c.stay_id!==null||c.patient_id!==null)return {id,eligible:false,label:c.temporary_case_code,reason:'Only unlinked PRE_ER placeholder cases can be permanently removed'};
 for(const table of ['pre_er_assessments','pre_er_vitals','ambulance_transports']){
  const test=await client.query(`SELECT 1 FROM public.${table} WHERE case_id=$1 LIMIT 1`,[id]);
  if(test.rowCount)return {id,eligible:false,label:c.temporary_case_code,reason:`Has ${table} records; retain for clinical review`};
 }
 const problem=await blockedReferences(client,kind,id);
 return {id,label:c.temporary_case_code,eligible:!problem,reason:problem||null};
}
router.post('/preview',async(req,res)=>{
 const parsed=parse(req.body);if(!parsed)return res.status(400).json({error:'Choose 1–25 unique positive IDs and a valid cleanup category'});
 try {
  const rows=[];
  for(const id of parsed.ids)rows.push(await eligible(pool,parsed.kind,id,req.user.user_id));
  res.json({kind:parsed.kind,rows,eligible:rows.filter(r=>r.eligible).length,blocked:rows.filter(r=>!r.eligible).length});
 }catch(e){console.error('Cleanup preview:',e.code||e.message);res.status(500).json({error:'Cleanup preview unavailable'});}
});
router.post('/execute',async(req,res)=>{
 const parsed=parse(req.body);const reason=req.body?.reason;
 if(!parsed||typeof reason!=='string'||reason.trim().length<10||reason.length>500||req.body?.confirmation!==`DELETE ${parsed.ids.length}`)
  return res.status(400).json({error:'Select 1–25 IDs, enter a 10–500 character reason, and confirm DELETE followed by the selected count'});
 // Fail the entire batch if any candidate is ineligible. No partial deletion.
 const client=await pool.connect();let tx=false;
 try{
  await client.query('BEGIN');tx=true;
  const checked=[];
  for(const id of parsed.ids){checked.push(await eligible(client,parsed.kind,id,req.user.user_id,true));}
  const bad=checked.filter(x=>!x.eligible);
  if(bad.length){await client.query('ROLLBACK');tx=false;return res.status(409).json({error:'No records were deleted: one or more are not eligible',rows:checked});}
  for(const item of checked){
   const id=item.id;
   // Account-only artifacts are removed, clinical records are NEVER cascaded.
   if(parsed.kind==='users'){
    await client.query('DELETE FROM public.admin_password_resets WHERE user_id=$1',[id]);
    await client.query('DELETE FROM public.doctor_invitations WHERE user_id=$1',[id]);
    await client.query('DELETE FROM public.doctor_profiles WHERE user_id=$1',[id]);
    await client.query('DELETE FROM public.staff_profiles WHERE user_id=$1',[id]);
    await client.query('DELETE FROM public.users WHERE user_id=$1',[id]);
   }else await client.query('DELETE FROM public.emergency_cases WHERE case_id=$1',[id]);
   await client.query(`INSERT INTO public.admin_action_audit(actor_user_id,action,target_type,target_id,reason)
    VALUES($1,$2,$3,$4,$5)`,[req.user.user_id,parsed.kind==='users'?'TEST_ACCOUNT_DELETED':'EMPTY_TEST_CASE_DELETED',parsed.kind==='users'?'USER':'CASE',String(id),`${reason.trim()} | ${item.label}`]);
  }
  await client.query('COMMIT');tx=false;
  res.json({message:`${checked.length} ${parsed.kind==='users'?'account(s)':'empty case(s)'} deleted`,deleted:checked.length,ids:parsed.ids});
 }catch(e){if(tx)await client.query('ROLLBACK').catch(()=>{});if(e.code==='23503')return res.status(409).json({error:'Related records were found; nothing was deleted'});console.error('Cleanup execute:',e.code||e.message);res.status(500).json({error:'Cleanup transaction failed; nothing was deleted'});}
 finally{client.release();}
});
module.exports=router;
