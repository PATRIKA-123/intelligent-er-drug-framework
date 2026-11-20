"use strict";
const express=require('express');
const router=express.Router();
const pool=require('../db');
const auth=require('../middleware/authMiddleware');
const {positiveInt,validatePatient,createPatient}=require('../services/round2Registration');
router.use(auth);
router.get('/',auth.requireRole('ADMIN','ER_STAFF','DOCTOR'),async(req,res)=>{
  const rawLimit=req.query.limit??'25',rawOffset=req.query.offset??'0';
  if(!/^\d+$/.test(String(rawLimit))||!/^\d+$/.test(String(rawOffset))) return res.status(400).json({error:'Invalid pagination'});
  const limit=Number(rawLimit),offset=Number(rawOffset);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(offset)) return res.status(400).json({error:'Invalid pagination'});
  const q=typeof req.query.q==='string'?req.query.q.trim():'';
  if(q.length>150) return res.status(400).json({error:'Search too long'});
  if(q.length<2) return res.status(400).json({error:'Enter at least 2 characters to search patients'});
  const numeric=positiveInt(q);
  try {
    const where=`(p.full_name ILIKE $1 ESCAPE '\\' OR p.phone ILIKE $1 ESCAPE '\\' OR p.subject_id=$2)\n      AND ($3::text <> 'DOCTOR' OR EXISTS (\n        SELECT 1 FROM public.ed_stays s\n        JOIN public.stay_doctor_assignments a ON a.stay_id=s.stay_id\n        WHERE s.subject_id=p.subject_id AND a.doctor_user_id=$4\n          AND a.status='ACTIVE' AND a.ended_at IS NULL))`;
    const escaped=q.replace(/[\\%_]/g,'\\$&');
    const params=[`%${escaped}%`,numeric,req.user.role,req.user.user_id];
    const [rows,count]=await Promise.all([
      pool.query(`SELECT p.patient_id,p.subject_id,p.full_name,p.date_of_birth,p.phone,p.is_temporary FROM public.patients p WHERE ${where}
        ORDER BY p.patient_id DESC LIMIT $5 OFFSET $6`,[...params,limit,offset]),
      pool.query(`SELECT COUNT(*)::int AS n FROM public.patients p WHERE ${where}`,params)
    ]);
    return res.json({count:Number(count.rows[0].n),patients:rows.rows});
  }catch(err){console.error('T5 patient search error:',err.code||'DB_ERROR');return res.status(500).json({error:'Failed to search patients'});}
});
router.post('/',auth.requireRole('ADMIN','ER_STAFF'),async(req,res)=>{
  let client;
  try {
    const input=validatePatient(req.body||{});
    client=await pool.connect();
    await client.query('BEGIN');
    const patient=await createPatient(client,input,req.user.user_id);
    await client.query('COMMIT');
    return res.status(201).json({patient});
  }catch(err){if(client)try{await client.query('ROLLBACK');}catch{};return res.status(err.statusCode||500).json({error:err.statusCode?err.message:'Could not create patient'});}
  finally{client?.release();}
});
module.exports=router;
