"use strict";
const crypto = require("node:crypto");
const pool = require("../db");
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
function positiveInt(v) { const n = Number(v); return /^\d+$/.test(String(v)) && Number.isSafeInteger(n) && n > 0 ? n : null; }
function fail(statusCode, message) { const e = new Error(message); e.statusCode = statusCode; return e; }
function accessCode() {
  // randomInt uses rejection sampling; the 31-symbol alphabet stays unbiased.
  const raw = Array.from({length:8}, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
  return `${raw.slice(0,4)}-${raw.slice(4)}`;
}
function validatePatient(input, requireAny = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Invalid patient');
  const full_name = input.full_name == null ? null : String(input.full_name).trim();
  const phone = input.phone == null ? null : String(input.phone).trim();
  const email = input.email == null ? null : String(input.email).trim().toLowerCase();
  const dob = input.date_of_birth == null ? null : String(input.date_of_birth);
  if (full_name !== null && (!full_name || full_name.length > 150)) throw fail(400, 'Invalid full_name');
  if (phone !== null && (!/^\+?[0-9 ()-]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) throw fail(400, 'Invalid phone');
  if (email !== null && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150)) throw fail(400, 'Invalid email');
  if (dob !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob)) || new Date(dob).toISOString().slice(0,10) !== dob || dob > new Date().toISOString().slice(0,10)) throw fail(400, 'Invalid date_of_birth');
  }
  if (requireAny && ![full_name, phone, email, dob].some(Boolean)) throw fail(400, 'Provide patient details');
  return {full_name, date_of_birth:dob, phone, email, is_temporary: ![full_name, phone, email, dob].some(Boolean)};
}
async function createPatient(client, raw, actor) {
  const p = validatePatient(raw);
  const r = await client.query(`INSERT INTO public.patients
   (subject_id,data_source,full_name,date_of_birth,phone,email,is_temporary,created_by)
   VALUES (nextval('public.parvah_patient_subject_seq'),'PARVAH', $1,$2,$3,$4,$5,$6)
   RETURNING patient_id,subject_id,full_name,date_of_birth,phone,email,is_temporary`,
   [p.full_name,p.date_of_birth,p.phone,p.email,p.is_temporary,actor]);
  return r.rows[0];
}
async function linkCaseToStay(client, caseId, stayId) {
  const id = positiveInt(caseId), sid = positiveInt(stayId);
  if (!id || !sid) throw fail(400, 'Invalid case or stay ID');
  const c = await client.query(`SELECT case_id,patient_id,stay_id,temporary_case_code,case_status,source,created_by,created_at
      FROM public.emergency_cases WHERE case_id=$1 FOR UPDATE`,[id]);
  if (!c.rows.length) throw fail(404,'Emergency case not found');
  const old = c.rows[0];
  if (old.stay_id && String(old.stay_id)!==String(sid)) throw fail(409,'Emergency case is already linked to a different ER stay');
  const s = await client.query(`SELECT e.stay_id,p.patient_id FROM public.ed_stays e
      JOIN public.patients p ON p.subject_id=e.subject_id WHERE e.stay_id=$1 FOR SHARE OF e`,[sid]);
  if (!s.rows.length) throw fail(404,'ED stay or linked patient not found');
  const patientId=s.rows[0].patient_id;
  if (old.patient_id!=null && String(old.patient_id)!==String(patientId)) throw fail(409,'Emergency case patient does not match the ER stay patient');
  if (!old.stay_id && old.case_status!=='PRE_ER') throw fail(409,`Cannot link an ER stay while case status is ${old.case_status}`);
  const duplicate=await client.query(`SELECT case_id FROM public.emergency_cases
      WHERE stay_id=$1 AND case_id<>$2 FOR UPDATE`,[sid,id]);
  if (duplicate.rows.length) throw fail(409,'ER stay is already linked to another emergency case');
  // Retry with the same case/stay must not move the transport timeline backwards.
  if (old.stay_id) return old;
  const result=await client.query(`UPDATE public.emergency_cases SET patient_id=$1,stay_id=$2,
      case_status=CASE WHEN case_status='PRE_ER' THEN 'ARRIVED_ER' ELSE case_status END
      WHERE case_id=$3 RETURNING case_id,patient_id,stay_id,temporary_case_code,case_status,source,created_by,created_at`,[patientId,sid,id]);
  await client.query(`UPDATE public.ambulance_transports
      SET transport_status='ARRIVED_AT_DESTINATION',arrival_time=COALESCE(arrival_time,CURRENT_TIMESTAMP)
      WHERE transport_id=(SELECT transport_id FROM public.ambulance_transports
        WHERE case_id=$1 AND transport_status IN ('DISPATCHED','EN_ROUTE','IN_TRANSIT','ARRIVED_AT_DESTINATION')
        ORDER BY created_at DESC,transport_id DESC LIMIT 1)
      AND transport_status IN ('DISPATCHED','EN_ROUTE','IN_TRANSIT')`,[id]);
  return result.rows[0];
}
async function registerVisit(data, actor, idempotencyKey) {
  if (!positiveInt(actor)) throw fail(403,'Unauthorized');
  if (typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_.:-]{12,128}$/.test(idempotencyKey)) throw fail(400,'Idempotency-Key header is required (12-128 characters)');
  if (!data||typeof data!=='object'||Array.isArray(data)) throw fail(400,'Invalid body');
  const existingId=data.patient_id==null?null:positiveInt(data.patient_id);
  if (data.patient_id!=null&&!existingId) throw fail(400,'Invalid patient_id');
  if (existingId && data.patient!=null) throw fail(400,'Provide patient_id OR patient, not both');
  if (data.case_id!=null&&!positiveInt(data.case_id)) throw fail(400,'Invalid case_id');
  if (data.doctor_user_id!=null&&!positiveInt(data.doctor_user_id)) throw fail(400,'Invalid doctor_user_id');
  const complaint=data.chiefcomplaint==null?null:String(data.chiefcomplaint).trim();
  if (complaint&&complaint.length>500) throw fail(400,'chiefcomplaint too long');
  const acuity=data.acuity==null?null:Number(data.acuity);
  if (acuity!=null&&(!Number.isInteger(acuity)||acuity<1||acuity>5)) throw fail(400,'Invalid acuity');
  if (!existingId) validatePatient(data.patient||{});
  const payloadHash=sha(JSON.stringify(data));
  const keyHash=sha(`${actor}:${idempotencyKey}`);
  const client=await pool.connect(); let inTx=false;
  try {
    await client.query('BEGIN'); inTx=true;
    const gate=await client.query(`INSERT INTO public.visit_registration_requests(key_hash,created_by,payload_hash)
      VALUES($1,$2,$3) ON CONFLICT(key_hash) DO NOTHING RETURNING key_hash`,[keyHash,actor,payloadHash]);
    if (!gate.rowCount) {
      const previous=await client.query(`SELECT stay_id,payload_hash,processing_status FROM public.visit_registration_requests WHERE key_hash=$1 FOR UPDATE`,[keyHash]);
      if (!previous.rows.length) throw fail(409,'Registration is being processed');
      if (previous.rows[0].payload_hash!==payloadHash) throw fail(409,'Idempotency-Key reused for different registration');
      await client.query('COMMIT');inTx=false;
      return {replayed:true,stay_id:previous.rows[0].stay_id,processing:{status:previous.rows[0].processing_status},access_code:null};
    }
    let patient;
    if (existingId) {
      const r=await client.query(`SELECT patient_id,subject_id,phone FROM public.patients WHERE patient_id=$1 FOR SHARE`,[existingId]);
      if (!r.rows.length) throw fail(404,'Patient not found');
      patient=r.rows[0];
    } else patient=await createPatient(client,data.patient||{},actor);
    const inserted=await client.query(`INSERT INTO public.ed_stays(stay_id,subject_id,intime,chiefcomplaint,acuity)
      VALUES(nextval('public.parvah_stay_id_seq'),$1,CURRENT_TIMESTAMP,$2,$3) RETURNING stay_id`,[patient.subject_id,complaint||null,acuity]);
    const stayId=inserted.rows[0].stay_id;
    const linked=data.case_id!=null?await linkCaseToStay(client,data.case_id,stayId):null;
    let assigned=null;
    if (data.doctor_user_id!=null) {
      const doctor=await client.query(`SELECT u.user_id,dp.full_name FROM public.users u
        JOIN public.doctor_profiles dp ON dp.user_id=u.user_id
        WHERE u.user_id=$1 AND u.role='DOCTOR' AND u.is_active=TRUE`,[data.doctor_user_id]);
      if (!doctor.rows.length) throw fail(404,'Active doctor not found');
      const assignment=await client.query(`INSERT INTO public.stay_doctor_assignments(stay_id,doctor_user_id,assigned_by,status)
        VALUES($1,$2,$3,'ACTIVE') RETURNING assignment_id`,[stayId,data.doctor_user_id,actor]);
      assigned={user_id:doctor.rows[0].user_id,full_name:doctor.rows[0].full_name,assignment_id:assignment.rows[0].assignment_id};
    }
    const plain=accessCode();
    await client.query(`INSERT INTO public.visit_access_codes(stay_id,patient_id,code_hash,expires_at,created_by)
      VALUES($1,$2,$3,now()+interval '14 days',$4)`,[stayId,patient.patient_id,sha(plain.replace('-','')),actor]);
    await client.query(`UPDATE public.visit_registration_requests SET stay_id=$2 WHERE key_hash=$1`,[keyHash,stayId]);
    await client.query('COMMIT');inTx=false;
    return {stay_id:stayId,patient_id:patient.patient_id,case_linked:Boolean(linked),case:linked,assigned_doctor:assigned,
      access_code:plain,linked_profile:null,identity_link_status:'PENDING_VERIFICATION',phone_missing:!patient.phone,
      processing:{status:'PENDING_INPUTS'},_keyHash:keyHash};
  } catch(e) {
    if(inTx) try{await client.query('ROLLBACK');}catch{}
    if(e.code==='23505') throw fail(409,'A unique patient, stay or visit identifier already exists');
    throw e;
  } finally {client.release();}
}
async function processingStatus(keyHash,status) {
  if(!['PENDING_INPUTS','RUNNING','COMPLETED','FAILED'].includes(status)) return;
  await pool.query(`UPDATE public.visit_registration_requests SET processing_status=$2 WHERE key_hash=$1`,[keyHash,status]);
}
module.exports={positiveInt,validatePatient,accessCode,createPatient,linkCaseToStay,registerVisit,processingStatus};
