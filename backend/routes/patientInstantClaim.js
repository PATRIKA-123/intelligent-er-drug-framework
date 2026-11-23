'use strict';
// Staff-issued single-use access code + recorded phone last4 are sufficient
// to claim an UNCLAIMED visit. Never overrides an existing owner.
const express=require('express');
const crypto=require('node:crypto');
const pool=require('../db');
const auth=require('../middleware/authMiddleware');
const rateLimit=require('../middleware/rateLimit');
const router=express.Router();
router.post('/claim-visit',auth,auth.requireRole('PATIENT'),rateLimit({windowMs:15*60*1000,max:12}),async(req,res)=>{
 const userId=req.user.user_id;
 const input=req.body||{};
 const sid=/^\d{1,15}$/.test(String(input.stay_id))?Number(input.stay_id):NaN;
 const code=typeof input.access_code==='string'?input.access_code.toUpperCase().replace(/[ -]/g,''):'';
 const phone4=String(input.phone_last4||'');
 const invalid='These details do not match the ER slip. Check the visit ID, code and last four phone digits.';
 if(!Number.isSafeInteger(sid)||sid<=0||!/^[A-HJ-NP-Z2-9]{8}$/.test(code)||!/^\d{4}$/.test(phone4))return res.status(400).json({error:invalid});
 const digest=crypto.createHash('sha256').update(code).digest('hex');
 const ipDigest=crypto.createHash('sha256').update(String(req.ip||'unknown')+':'+process.env.JWT_SECRET).digest('hex');
 const c=await pool.connect();let tx=false;
 try {
  await c.query('BEGIN');tx=true;
  const locks=[`claim:user:${userId}`,`claim:ip:${ipDigest}`,`claim:stay:${sid}`].sort();
  for(const key of locks)await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',[key]);
  const attempts=await c.query(`SELECT count(*) FILTER(WHERE user_id=$1 AND NOT succeeded) AS by_user,
   count(*) FILTER(WHERE ip_digest=$2 AND NOT succeeded) AS by_ip,
   count(*) FILTER(WHERE stay_id=$3 AND NOT succeeded) AS by_stay
   FROM public.patient_claim_attempts WHERE attempted_at>now()-interval '1 hour'`,[userId,ipDigest,sid]);
  const counts=attempts.rows[0];
  if(Number(counts.by_user)>=5||Number(counts.by_ip)>=20||Number(counts.by_stay)>=20){await c.query('ROLLBACK');tx=false;return res.status(429).json({error:'Too many attempts. Try again later or contact the ER desk.'});}
  const stay=await c.query(`SELECT p.phone,v.stay_id,vc.code_id,vc.used_at,vc.expires_at
   FROM public.ed_stays v JOIN public.patients p ON p.subject_id=v.subject_id
   LEFT JOIN public.visit_access_codes vc ON vc.stay_id=v.stay_id AND vc.code_hash=$2 AND vc.revoked_at IS NULL
   WHERE v.stay_id=$1 FOR UPDATE OF v`,[sid,digest]);
  const r=stay.rows[0];
  const last4=String(r?.phone||'').replace(/\D/g,'').slice(-4);
  const owner=await c.query('SELECT user_id FROM public.patient_visit_access WHERE stay_id=$1',[sid]);
  // A previously consumed code is only accepted idempotently for its owner.
  if(owner.rowCount&&Number(owner.rows[0].user_id)===userId && r?.code_id && last4===phone4){
   await c.query('COMMIT');tx=false;return res.json({status:'LINKED',message:'This visit is already in your profile.',stay_id:sid});
  }
  const ok=Boolean(r&&r.code_id&&!r.used_at&&new Date(r.expires_at)>new Date()&&last4.length===4&&last4===phone4&&!owner.rowCount);
  if(!ok){await c.query('INSERT INTO public.patient_claim_attempts(user_id,stay_id,ip_digest,succeeded) VALUES($1,$2,$3,FALSE)',[userId,sid,ipDigest]);await c.query('COMMIT');tx=false;return res.status(400).json({error:invalid});}
  const taken=await c.query(`UPDATE public.visit_access_codes SET used_at=now(),used_by=$2 WHERE code_id=$1
   AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING code_id`,[r.code_id,userId]);
  if(!taken.rowCount){await c.query('ROLLBACK');tx=false;return res.status(409).json({error:'Access code was used or expired. Request a new code.'});}
  await c.query(`INSERT INTO public.patient_visit_access(user_id,stay_id,source) VALUES($1,$2,'CLAIMED')`,[userId,sid]);
  // Close the user's existing pending claim if one was submitted using the old flow.
  await c.query(`UPDATE public.patient_identity_reviews SET status='APPROVED',verified_by=NULL,
    verification_method='STAFF_ISSUED_ONE_TIME_CODE',reason='Single-use code and hospital phone digits verified',reviewed_at=now()
    WHERE stay_id=$1 AND requesting_user_id=$2 AND action='CLAIM' AND status='PENDING_VERIFICATION'`,[sid,userId]);
  await c.query(`INSERT INTO public.patient_identity_audit(stay_id,actor_id,action,prior_user_id,new_user_id)
   VALUES($1,$2,'CLAIM_AUTO_APPROVED',NULL,$2)`,[sid,userId]);
  await c.query('INSERT INTO public.patient_claim_attempts(user_id,stay_id,ip_digest,succeeded) VALUES($1,$2,$3,TRUE)',[userId,sid,ipDigest]);
  await c.query('COMMIT');tx=false;
  return res.json({message:'Visit added to your profile.',status:'LINKED',stay_id:sid});
 }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});console.error('Instant claim error:',e.code||'DB_ERROR');
   return res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'This visit is already linked to a profile. Contact the ER desk.':'Unable to add this visit right now.'});}
 finally{c.release();}
});
module.exports=router;
