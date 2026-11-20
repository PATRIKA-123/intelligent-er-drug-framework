"use strict";
const express=require('express');
const bcrypt=require('bcrypt');
const pool=require('../db');
const auth=require('../middleware/authMiddleware');
const limit=require('../middleware/rateLimit');
const S=require('../services/round2Patient');
const router=express.Router();
router.post('/register',limit({windowMs:15*60*1000,max:8}),S.safeBody(async(req,res)=>res.status(201).json(await S.register(req.body))));
router.use(auth,auth.requireRole('PATIENT'));
router.get('/me',S.safeBody(async(req,res)=>{
 const userId=req.user.user_id,profile=await S.getProfile(userId);if(!profile)throw S.error(404,'Patient profile not found');
 const rows=await pool.query(`SELECT s.stay_id,s.intime AS arrived,s.chiefcomplaint,s.visit_status
   FROM public.patient_visit_access a JOIN public.ed_stays s ON s.stay_id=a.stay_id
   WHERE a.user_id=$1 ORDER BY s.intime DESC NULLS LAST,s.stay_id DESC LIMIT 100`,[userId]);
 const visits=[];
 for(const v of rows.rows){
  const rx=await pool.query(`SELECT prescription_id,stay_id,medication_name,dosage,frequency,duration,status
    FROM public.prescriptions WHERE stay_id=$1 AND status='AUTHORIZED' ORDER BY prescribed_at DESC LIMIT 100`,[v.stay_id]);
  const fu=await pool.query(`SELECT follow_up_id,follow_up_date,follow_up_type,department,status
    FROM public.follow_ups WHERE stay_id=$1 ORDER BY follow_up_date DESC LIMIT 100`,[v.stay_id]);
  const dc=await pool.query(`SELECT discharge_instructions FROM public.discharges WHERE stay_id=$1 ORDER BY created_at DESC LIMIT 1`,[v.stay_id]);
  visits.push({...v,status:v.visit_status==='ACTIVE'?'In the ER':v.visit_status==='DEPARTED'?'Left':'Discharged',
    instructions:dc.rows[0]?.discharge_instructions||null,
    prescriptions:rx.rows.map(p=>({...p,active:null,activity_status:'UNKNOWN'})),follow_ups:fu.rows});
 }
 const {emergency_contact_name:name,emergency_contact_phone:phone,...publicProfile}=profile;
 return res.json({profile:{...publicProfile,emergency_contact:name&&phone?{name,phone}:null},visits});
}));
router.patch('/profile',S.safeBody(async(req,res)=>{
 const d=req.body||{};if(!d||typeof d!=='object'||Array.isArray(d))throw S.error(400,'Invalid profile');
 const current=await S.getProfile(req.user.user_id);if(!current)throw S.error(404,'Profile not found');
 const full=d.full_name===undefined?current.full_name:S.requireString(d.full_name,150);
 const phone=d.phone===undefined?current.phone:S.requireString(d.phone,30);
 const email=d.email===undefined?current.email:S.optional(d.email,150);
 const share=d.share===undefined?current.share:d.share;
 const contact=d.emergency_contact;
 if(!full||!phone||phone.replace(/\D/g,'').length<7||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||typeof share!=='boolean')throw S.error(400,'Invalid profile fields');
 let contactName=current.emergency_contact_name,contactPhone=current.emergency_contact_phone;
 if(contact!==undefined){if(contact===null){contactName=null;contactPhone=null;}
 else {contactName=S.requireString(contact.name,150);contactPhone=S.requireString(contact.phone,30);if(!contactName||!contactPhone)throw S.error(400,'Both contact name and phone required');}}
 await pool.query(`UPDATE public.patient_profiles SET full_name=$2,phone=$3,email=$4,share_history=$5,
  consent_changed_at=CASE WHEN share_history IS DISTINCT FROM $5 THEN now() ELSE consent_changed_at END,
  consent_version=CASE WHEN share_history IS DISTINCT FROM $5 THEN consent_version+1 ELSE consent_version END,
  emergency_contact_name=$6,emergency_contact_phone=$7,updated_at=now() WHERE user_id=$1`,
  [req.user.user_id,full,phone,email,share,contactName,contactPhone]);
 // Contact changes are profile-only; demographic changes are NOT propagated into historical hospital records.
 return res.json({message:'Profile updated'});
}));
router.post('/password',S.safeBody(async(req,res)=>{
 const d=req.body||{};if(typeof d.current_password!=='string'||typeof d.new_password!=='string'||d.new_password.length<12||d.new_password.length>128)throw S.error(400,'Invalid password request');
 const r=await pool.query('SELECT password_hash FROM public.users WHERE user_id=$1',[req.user.user_id]);
 if(!r.rows.length||!await bcrypt.compare(d.current_password,r.rows[0].password_hash))throw S.error(400,'Your current password is not correct.');
 const hash=await bcrypt.hash(d.new_password,12);await pool.query('UPDATE public.users SET password_hash=$2 WHERE user_id=$1',[req.user.user_id,hash]);
 return res.json({message:'Password updated; sign in again'});
}));
const types={allergies:['patient_allergies','reaction',200],medications:['patient_medications','dose',100],conditions:['patient_conditions','note',200]};
router.get('/health',S.safeBody(async(req,res)=>{
 const out={};for(const [key,[table,field]] of Object.entries(types)){
  const r=await pool.query(`SELECT id,name,${field} FROM public.${table} WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`,[req.user.user_id]);out[key]=r.rows;
 }return res.json({...out,provenance:'PATIENT_REPORTED_UNVERIFIED'});
}));
for(const [key,[table,field,max]] of Object.entries(types)){
 router.post('/'+key,S.safeBody(async(req,res)=>{
  const name=S.requireString(req.body?.name,150),v=S.optional(req.body?.[field],max);if(!name)throw S.error(400,'Name is required (1-150 characters)');
  const n=await pool.query(`SELECT count(*)::int AS n FROM public.${table} WHERE user_id=$1`,[req.user.user_id]);if(Number(n.rows[0].n)>=50)throw S.error(409,'Item limit reached');
  const r=await pool.query(`INSERT INTO public.${table}(user_id,name,${field}) VALUES($1,$2,$3) RETURNING id,name,${field}`,[req.user.user_id,name,v]);
  return res.status(201).json({...r.rows[0],provenance:'PATIENT_REPORTED_UNVERIFIED'});
 }));
 router.delete('/'+key+'/:id',S.safeBody(async(req,res)=>{
  const id=S.positiveInt(req.params.id);if(!id)throw S.error(400,'Invalid id');
  const r=await pool.query(`DELETE FROM public.${table} WHERE id=$1 AND user_id=$2 RETURNING id`,[id,req.user.user_id]);
  if(!r.rowCount)throw S.error(404,'Item not found');return res.json({message:'Item removed'});
 }));
}
router.post('/claim-visit',S.safeBody(async(req,res)=>res.status(202).json(await S.claimVisit(req.user.user_id,req.body?.stay_id,req.body?.access_code,req.body?.phone_last4,req.ip))));
router.get('/claim-requests',S.safeBody(async(req,res)=>{
 const r=await pool.query(`SELECT review_id,stay_id,status,created_at,reviewed_at FROM public.patient_identity_reviews WHERE requesting_user_id=$1 ORDER BY created_at DESC LIMIT 30`,[req.user.user_id]);return res.json({requests:r.rows});
}));
module.exports=router;
