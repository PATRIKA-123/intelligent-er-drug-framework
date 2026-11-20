"use strict";
const crypto = require('node:crypto');
const pool = require('../db');
const bcrypt = require('bcrypt');
const {validatePatient,positiveInt} = require('./round2Registration');
function error(code,msg){const e=new Error(msg);e.statusCode=code;return e;}
function ipHash(ip){return crypto.createHash('sha256').update(String(ip||'unknown')+':'+process.env.JWT_SECRET).digest('hex');}
function safeBody(fn){return async(req,res)=>{try{return await fn(req,res);}catch(e){if(!e.statusCode) console.error('Patient service error:',e.code||'INTERNAL_ERROR');return res.status(e.statusCode||500).json({error:e.statusCode?e.message:'Operation unavailable',code:e.statusCode===409?'CONFLICT':e.statusCode===429?'RATE_LIMITED':e.statusCode===403?'FORBIDDEN':'REQUEST_FAILED'});}};}
const emailOk=s=>s===null||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function requireString(v,max){return typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim():null;}
function optional(v,max){if(v===null||v===undefined||v==='')return null;const s=requireString(v,max);if(!s)throw error(400,'Invalid text field');return s;}
function validDob(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&v<=new Date().toISOString().slice(0,10);}
async function register(d){
 if(!d||typeof d!=='object'||Array.isArray(d)) throw error(400,'Invalid registration');
 const full=requireString(d.full_name,150),dob=d.dob,phone=requireString(d.phone,30),email=d.email==null||d.email===''?null:optional(d.email,150)?.toLowerCase(),password=d.password;
 if(!full||!validDob(dob)||!phone||phone.replace(/\D/g,'').length<7||!emailOk(email)||typeof password!=='string'||password.length<12||password.length>128)throw error(400,'Invalid registration details');
 const username=email||phone,share=d.share===true;const hash=await bcrypt.hash(password,12);
 const client=await pool.connect();let tx=false;
 try{await client.query('BEGIN');tx=true;
  const u=await client.query(`INSERT INTO public.users(username,email,password_hash,role,is_active) VALUES($1,$2,$3,'PATIENT',TRUE) RETURNING user_id`,[username,email,hash]);
  const p=await client.query(`INSERT INTO public.patients(subject_id,data_source,full_name,date_of_birth,phone,email,is_temporary,created_by)
   VALUES(nextval('public.parvah_patient_subject_seq'),'PARVAH',$1,$2,$3,$4,FALSE,$5) RETURNING patient_id`,[full,dob,phone,email,u.rows[0].user_id]);
  await client.query(`INSERT INTO public.patient_profiles(user_id,patient_id,full_name,date_of_birth,phone,email,share_history)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[u.rows[0].user_id,p.rows[0].patient_id,full,dob,phone,email,share]);
  await client.query('COMMIT');tx=false;return {message:'Profile created',username};
 }catch(e){if(tx)await client.query('ROLLBACK');if(e.code==='23505')throw error(409,'Unable to register with those details');throw e;}finally{client.release();}
}
async function claimVisit(userId,stayId,code,phone4,ip){
 const sid=positiveInt(stayId);if(!sid||typeof code!=='string'||typeof phone4!=='string')throw error(400,'These details don\'t match. Check the slip from the ER desk and try again.');
 const generic='These details don\'t match. Check the slip from the ER desk and try again.';
 const normalized=code.toUpperCase().replace(/[ -]/g,'');const digest=/^[A-HJ-NP-Z2-9]{8}$/.test(normalized)?crypto.createHash('sha256').update(normalized).digest('hex'):null;
 const ipDigest=ipHash(ip);const client=await pool.connect();let tx=false;
 try{await client.query('BEGIN');tx=true;
  // Serialize per user, IP and target visit; sorted lock keys avoid deadlocks.
  const locks=[`claim:user:${userId}`,`claim:ip:${ipDigest}`,`claim:stay:${sid}`].sort();
  for(const key of locks)await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))`,[key]);
  const limits=await client.query(`SELECT
    count(*) FILTER(WHERE user_id=$1 AND NOT succeeded) AS account_count,
    count(*) FILTER(WHERE ip_digest=$2 AND NOT succeeded) AS ip_count,
    count(*) FILTER(WHERE stay_id=$3 AND NOT succeeded) AS stay_count
    FROM public.patient_claim_attempts WHERE attempted_at>now()-interval '1 hour'`,[userId,ipDigest,sid]);
  const n=limits.rows[0];if(Number(n.account_count)>=5||Number(n.ip_count)>=20||Number(n.stay_count)>=20)throw error(429,'Too many tries. Please wait a few minutes, or ask the ER desk for help.');
  const record=await client.query(`SELECT p.phone,v.stay_id,vc.code_id,vc.used_at,vc.expires_at
   FROM public.ed_stays v JOIN public.patients p ON p.subject_id=v.subject_id
   LEFT JOIN public.visit_access_codes vc ON vc.stay_id=v.stay_id AND vc.code_hash=$2 AND vc.revoked_at IS NULL
   WHERE v.stay_id=$1 FOR UPDATE OF v`,[sid,digest]);
  const row=record.rows[0];const last=String(row?.phone||'').replace(/\D/g,'').slice(-4);
  let permitted=Boolean(row&&row.code_id&&!row.used_at&&new Date(row.expires_at)>new Date()&&/^\d{4}$/.test(phone4)&&last===phone4);
  if(permitted){const owner=await client.query('SELECT user_id FROM public.patient_visit_access WHERE stay_id=$1',[sid]);if(owner.rows.length)permitted=false;}
  if(!permitted){await client.query('INSERT INTO public.patient_claim_attempts(user_id,stay_id,ip_digest,succeeded) VALUES($1,$2,$3,FALSE)',[userId,sid,ipDigest]);await client.query('COMMIT');tx=false;throw error(400,generic);}
  // Hold code pending staff verification; DO NOT grant access or consume code here.
  const review=await client.query(`INSERT INTO public.patient_identity_reviews(stay_id,requesting_user_id,action,code_id)
    VALUES($1,$2,'CLAIM',$3) ON CONFLICT DO NOTHING RETURNING review_id`,[sid,userId,row.code_id]);
  await client.query('INSERT INTO public.patient_claim_attempts(user_id,stay_id,ip_digest,succeeded) VALUES($1,$2,$3,TRUE)',[userId,sid,ipDigest]);
  await client.query('COMMIT');tx=false;return {message:'Verification request submitted',status:'PENDING_VERIFICATION',review_id:review.rows[0]?.review_id||null};
 }catch(e){if(tx)await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function reviewIdentity(actor,id,decision,method,reason){
 const reviewId=positiveInt(id);if(!reviewId||!['APPROVED','REJECTED'].includes(decision)||!requireString(reason,500)||!requireString(method,200))throw error(400,'Verification decision, method and justification required');
 const client=await pool.connect();let tx=false;
 try{await client.query('BEGIN');tx=true;
  const r=await client.query(`SELECT * FROM public.patient_identity_reviews WHERE review_id=$1 FOR UPDATE`,[reviewId]);
  const v=r.rows[0];if(!v)throw error(404,'Review not found');if(v.status!=='PENDING_VERIFICATION')throw error(409,'Review already decided');
  // Serialize all approvals/corrections for the stay.
  await client.query('SELECT stay_id FROM public.ed_stays WHERE stay_id=$1 FOR UPDATE',[v.stay_id]);
  let previous=null;
  if(decision==='APPROVED'){
   const current=await client.query('SELECT user_id FROM public.patient_visit_access WHERE stay_id=$1 FOR UPDATE',[v.stay_id]);previous=current.rows[0]?.user_id||null;
   if(v.action==='CLAIM' && previous)throw error(409,'Visit already belongs to another profile');
   if(v.action==='CLAIM'){
     const update=await client.query(`UPDATE public.visit_access_codes SET used_at=now(),used_by=$2
       WHERE stay_id=$1 AND code_id=$3 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING code_id`,[v.stay_id,v.requesting_user_id,v.code_id]);
     if(update.rowCount!==1)throw error(409,'Claim code expired or no longer available');
     await client.query(`INSERT INTO public.patient_visit_access(user_id,stay_id,source) VALUES($1,$2,'STAFF_VERIFIED')`,[v.requesting_user_id,v.stay_id]);
   } else {
     if(previous)await client.query('DELETE FROM public.patient_visit_access WHERE stay_id=$1',[v.stay_id]);
     await client.query(`INSERT INTO public.patient_visit_access(user_id,stay_id,source) VALUES($1,$2,'STAFF_VERIFIED')`,[v.requesting_user_id,v.stay_id]);
   }
  }
  await client.query(`UPDATE public.patient_identity_reviews SET status=$2,reason=$3,verification_method=$4,verified_by=$5,reviewed_at=now() WHERE review_id=$1`,[reviewId,decision,reason,method,actor]);
  await client.query(`INSERT INTO public.patient_identity_audit(stay_id,actor_id,action,prior_user_id,new_user_id,review_id)
    VALUES($1,$2,$3,$4,$5,$6)`,[v.stay_id,actor,`${v.action}_${decision}`,previous,decision==='APPROVED'?v.requesting_user_id:null,reviewId]);
  await client.query('COMMIT');tx=false;return {review_id:reviewId,status:decision};
 }catch(e){if(tx)await client.query('ROLLBACK');if(e.code==='23505')throw error(409,'Visit ownership conflict');throw e;}finally{client.release();}
}
async function getProfile(userId){const r=await pool.query(`SELECT full_name,date_of_birth AS dob,phone,email,share_history AS share,emergency_contact_name,emergency_contact_phone,consent_changed_at,consent_version FROM public.patient_profiles WHERE user_id=$1`,[userId]);return r.rows[0]||null;}
module.exports={error,safeBody,requireString,optional,validDob,register,claimVisit,reviewIdentity,getProfile,positiveInt};
