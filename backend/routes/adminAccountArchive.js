'use strict';
// Remove interactive access for accounts with clinical and audit dependencies.
// This is archival (logical deletion), NEVER a false claim of physical erasure.
const express=require('express');
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const pool=require('../db');
const auth=require('../middleware/authMiddleware');
const router=express.Router();
router.use(auth,auth.requireRole('ADMIN'));
router.post('/users/:id/archive',async(req,res)=>{
 const id=/^\d{1,9}$/.test(req.params.id)?Number(req.params.id):0;
 const reason=req.body?.reason,phrase=req.body?.confirmation;
 if(!id||typeof reason!=='string'||reason.trim().length<12||reason.length>500||phrase!=='ARCHIVE ACCOUNT')return res.status(400).json({error:'A reason (12-500 characters) and ARCHIVE ACCOUNT confirmation are required.'});
 if(id===req.user.user_id)return res.status(403).json({error:'You cannot archive your own signed-in account.'});
 const c=await pool.connect();let tx=false;
 try{
  await c.query('BEGIN');tx=true;
  await c.query('SELECT pg_advisory_xact_lock($1)',[912401]);
  const target=await c.query('SELECT user_id,username,role,is_active,archived_at FROM public.users WHERE user_id=$1 FOR UPDATE',[id]);
  if(!target.rowCount){await c.query('ROLLBACK');tx=false;return res.status(404).json({error:'Account not found.'});}
  const user=target.rows[0];
  if(user.archived_at){await c.query('ROLLBACK');tx=false;return res.status(409).json({error:'Account was already archived.'});}
  // Prevent removal of the last working administrator (as well as self-removal).
  if(user.role==='ADMIN'&&user.is_active){
   const count=await c.query("SELECT count(*)::int AS n FROM public.users WHERE role='ADMIN' AND is_active=TRUE AND archived_at IS NULL");
   if(count.rows[0].n<=1){await c.query('ROLLBACK');tx=false;return res.status(409).json({error:'Cannot archive the last active administrator.'});}
  }
  // Never leave a live ER patient assigned to a doctor who cannot log in.
  // Reassign active clinical responsibilities first using the ER assignment workflow.
  if(user.role==='DOCTOR'){
   const assigned=await c.query("SELECT count(*)::int AS n FROM public.stay_doctor_assignments WHERE doctor_user_id=$1 AND status='ACTIVE' AND ended_at IS NULL",[id]);
   if(assigned.rows[0].n>0){await c.query('ROLLBACK');tx=false;return res.status(409).json({error:`Doctor has ${assigned.rows[0].n} active assignment(s). Reassign patients before archiving this account.`});}
  }
  // Randomize the login secret. Do not change the username or clinical FK:
  // prescription/assignment author attribution must remain traceable.
  const unavailable=await bcrypt.hash(crypto.randomBytes(32).toString('hex'),12);
  await c.query('UPDATE public.users SET is_active=FALSE, archived_at=now(), password_hash=$2 WHERE user_id=$1',[id,unavailable]);
  await c.query('UPDATE public.admin_password_resets SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',[id]);
  await c.query('UPDATE public.doctor_invitations SET revoked_at=now() WHERE user_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL',[id]);
  await c.query(`INSERT INTO public.admin_action_audit(actor_user_id,action,target_type,target_id,reason) VALUES($1,'ACCOUNT_ARCHIVED','USER',$2,$3)`,[req.user.user_id,String(id),`${reason.trim()} | account=${user.username} | role=${user.role}`]);
  await c.query('COMMIT');tx=false;
  return res.json({message:'Account login disabled and account archived. Clinical and audit references were preserved.',user_id:id,archived:true});
 }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});console.error('Account archival:',e.code||'DB_ERROR');return res.status(500).json({error:'Account archival failed. No changes were committed.'});}
 finally{c.release();}
});
module.exports=router;
