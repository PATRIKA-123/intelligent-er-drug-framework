"use strict";
const express=require('express');
const pool=require('../db');
const auth=require('../middleware/authMiddleware');
const S=require('../services/round2Patient');
const {requireStayAccess}=require('../services/accessPolicy');
const router=express.Router();
router.use(auth);
// Must precede /:stay_id/* routes on the shared /api/stays mount.
router.get('/:stay_id/patient-history',auth.requireRole('ADMIN','ER_STAFF','DOCTOR'),requireStayAccess(),S.safeBody(async(req,res)=>{
 const sid=S.positiveInt(req.params.stay_id);
 if(!sid)throw S.error(400,'Invalid stay');
 const r=await pool.query(`SELECT a.user_id,p.full_name,p.share_history,p.consent_version
   FROM public.patient_visit_access a JOIN public.patient_profiles p ON p.user_id=a.user_id
   WHERE a.stay_id=$1`,[sid]);
 const profile=r.rows[0];
 // Audit every read, INCLUDING declined or absent consent. Never return unconsented health data.
 await pool.query(`INSERT INTO public.patient_identity_audit(stay_id,actor_id,action)
   VALUES($1,$2,$3)`,[sid,req.user.user_id,profile?.share_history?'HISTORY_CONSENTED_READ':'HISTORY_RESTRICTED_READ']);
 if(!profile)return res.json({linked:false});
 if(!profile.share_history)return res.json({linked:true,shared:false,name:profile.full_name});
 const visit=await pool.query(`SELECT s.stay_id,s.intime AS arrived,s.chiefcomplaint
  FROM public.patient_visit_access a JOIN public.ed_stays s ON s.stay_id=a.stay_id
  WHERE a.user_id=$1 AND s.stay_id<>$2 ORDER BY s.intime DESC NULLS LAST,s.stay_id DESC LIMIT 50`,[profile.user_id,sid]);
 const [al,med,conditions]=await Promise.all([
  pool.query('SELECT name,reaction FROM public.patient_allergies WHERE user_id=$1 LIMIT 50',[profile.user_id]),
  pool.query('SELECT name,dose FROM public.patient_medications WHERE user_id=$1 LIMIT 50',[profile.user_id]),
  pool.query('SELECT name,note FROM public.patient_conditions WHERE user_id=$1 LIMIT 50',[profile.user_id])]);
 return res.json({linked:true,shared:true,name:profile.full_name,consent_version:profile.consent_version,
   visits:visit.rows,allergies:[],medications:[],prescriptions:[],
   reported_allergies:al.rows,reported_medications:med.rows,reported_conditions:conditions.rows,
   patient_reported_provenance:'PATIENT_REPORTED_UNVERIFIED'});
}));
// T20 hospital-side patient details. Demographic edits NEVER grant portal identity access.
router.get('/:stay_id/patient-details',auth.requireRole('ADMIN','ER_STAFF'),requireStayAccess(),S.safeBody(async(req,res)=>{
 const sid=S.positiveInt(req.params.stay_id);if(!sid)throw S.error(400,'Invalid stay');
 const r=await pool.query(`SELECT p.full_name AS patient_name,p.date_of_birth AS dob,p.phone,p.email
 FROM public.ed_stays s JOIN public.patients p ON p.subject_id=s.subject_id WHERE s.stay_id=$1`,[sid]);
 if(!r.rows.length)throw S.error(404,'Stay not found');
 const linked=await pool.query(`SELECT p.full_name FROM public.patient_visit_access a
 JOIN public.patient_profiles p ON p.user_id=a.user_id WHERE a.stay_id=$1`,[sid]);
 return res.json({...r.rows[0],linked_profile:linked.rows[0]?.full_name||null});
}));
router.patch('/:stay_id/patient-details',auth.requireRole('ADMIN','ER_STAFF'),requireStayAccess(),S.safeBody(async(req,res)=>{
 const sid=S.positiveInt(req.params.stay_id);if(!sid)throw S.error(400,'Invalid stay');
 const d=req.body||{};
 if(!d||typeof d!=='object'||Array.isArray(d))throw S.error(400,'Invalid body');
 const allowed=['patient_name','dob','phone','email'];
 if(!allowed.some(k=>Object.prototype.hasOwnProperty.call(d,k)))throw S.error(400,'No patient details supplied');
 const name=d.patient_name===undefined?undefined:S.optional(d.patient_name,150);
 const dob=d.dob===undefined?undefined:(d.dob===null?null:S.validDob(d.dob)?d.dob:undefined);
 const phone=d.phone===undefined?undefined:S.optional(d.phone,30);
 const email=d.email===undefined?undefined:S.optional(d.email,150);
 if(d.dob!==undefined&&dob===undefined)throw S.error(400,'Invalid dob');
 if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw S.error(400,'Invalid email');
 if(phone && phone.replace(/\D/g,'').length<7)throw S.error(400,'Invalid phone');
 const client=await pool.connect();let tx=false;
 try{await client.query('BEGIN');tx=true;
  const lookup=await client.query(`SELECT p.patient_id FROM public.ed_stays s JOIN public.patients p ON p.subject_id=s.subject_id WHERE s.stay_id=$1 FOR UPDATE OF s,p`,[sid]);
  if(!lookup.rows.length)throw S.error(404,'Stay not found');
  await client.query(`UPDATE public.patients SET full_name=COALESCE($2,full_name),
   date_of_birth=COALESCE($3,date_of_birth),phone=COALESCE($4,phone),email=COALESCE($5,email)
   WHERE patient_id=$1`,[lookup.rows[0].patient_id,name??null,dob??null,phone??null,email??null]);
  await client.query(`INSERT INTO public.patient_identity_audit(stay_id,actor_id,action) VALUES($1,$2,'HOSPITAL_DETAILS_UPDATED')`,[sid,req.user.user_id]);
  await client.query('COMMIT');tx=false;
  return res.json({message:'Patient details saved',linked_profile:null,identity_match_status:'REQUIRES_STAFF_VERIFICATION'});
 }catch(e){if(tx)await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
// STAFF can generate a replacement code but never read an old code.
router.post('/:stay_id/access-code',auth.requireRole('ADMIN','ER_STAFF'),S.safeBody(async(req,res)=>{
 const sid=S.positiveInt(req.params.stay_id);if(!sid)throw S.error(400,'Invalid stay');
 const {accessCode}=require('../services/round2Registration');
 const crypto=require('node:crypto');const plain=accessCode();const digest=crypto.createHash('sha256').update(plain.replace('-','')).digest('hex');
 const client=await pool.connect();let tx=false;
 try{await client.query('BEGIN');tx=true;
  const stay=await client.query(`SELECT p.patient_id FROM public.ed_stays s JOIN public.patients p ON p.subject_id=s.subject_id WHERE s.stay_id=$1 FOR UPDATE OF s`,[sid]);if(!stay.rows.length)throw S.error(404,'Stay not found');
  await client.query(`UPDATE public.visit_access_codes SET revoked_at=now() WHERE stay_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,[sid]);
  await client.query(`INSERT INTO public.visit_access_codes(stay_id,patient_id,code_hash,expires_at,created_by) VALUES($1,$2,$3,now()+interval '14 days',$4)`,[sid,stay.rows[0].patient_id,digest,req.user.user_id]);
  await client.query('COMMIT');tx=false;return res.json({access_code:plain,expires_in_days:14});
 }catch(e){if(tx)await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
const admin=express.Router();admin.use(auth,auth.requireRole('ADMIN'));
admin.get('/identity-reviews',S.safeBody(async(req,res)=>{
 const r=await pool.query(`SELECT review_id,stay_id,requesting_user_id,action,status,created_at
 FROM public.patient_identity_reviews WHERE status='PENDING_VERIFICATION' ORDER BY created_at LIMIT 50`);
 return res.json({reviews:r.rows});
}));
admin.post('/identity-reviews/:id/decision',S.safeBody(async(req,res)=>res.json(await S.reviewIdentity(req.user.user_id,req.params.id,req.body?.decision,req.body?.verification_method,req.body?.reason))));
admin.post('/identity-corrections',S.safeBody(async(req,res)=>{
 const sid=S.positiveInt(req.body?.stay_id),uid=S.positiveInt(req.body?.target_user_id),reason=S.requireString(req.body?.reason,500);
 if(!sid||!uid||!reason)throw S.error(400,'Stay, target user and reason required');
 const target=await pool.query('SELECT user_id FROM public.patient_profiles WHERE user_id=$1',[uid]);if(!target.rows.length)throw S.error(404,'Profile not found');
 const r=await pool.query(`INSERT INTO public.patient_identity_reviews(stay_id,requesting_user_id,action,reason)
 VALUES($1,$2,'CORRECTION',$3) RETURNING review_id,status`,[sid,uid,reason]);return res.status(202).json(r.rows[0]);
}));
module.exports={stayRouter:router,adminRouter:admin};
