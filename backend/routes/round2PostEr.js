'use strict';
const express=require('express');const pool=require('../db');const auth=require('../middleware/authMiddleware');
const {requireStayAccess}=require('../services/accessPolicy');
const router=express.Router();
const limitParam=(raw,max=100)=>{const n=raw===undefined?50:Number(raw);return Number.isSafeInteger(n)&&n>0&&n<=max?n:null;};
function ownClause(user,alias='s'){
 if(user.role==='ADMIN')return {sql:'TRUE',params:[]};
 if(user.role==='DOCTOR')return {sql:`EXISTS(SELECT 1 FROM stay_doctor_assignments a WHERE a.stay_id=${alias}.stay_id AND a.doctor_user_id=$1 AND a.status='ACTIVE')`,params:[user.user_id]};
 if(user.role==='ER_STAFF')return {sql:`EXISTS(SELECT 1 FROM emergency_cases c WHERE c.stay_id=${alias}.stay_id AND c.case_status IN ('ARRIVED_ER','ACTIVE_ER','CLOSED'))`,params:[]};
 return {sql:'FALSE',params:[]};
}
router.get('/follow-ups',auth,auth.requireRole('ER_STAFF','ADMIN','DOCTOR'),async(req,res)=>{
 const limit=limitParam(req.query.limit),status=req.query.status||null,from=req.query.from||null,to=req.query.to||null;
 if(!limit||(status&&!['PLANNED','SCHEDULED','COMPLETED','CANCELLED','MISSED'].includes(status))||
 (from&&Number.isNaN(Date.parse(from)))||(to&&Number.isNaN(Date.parse(to))))return res.status(400).json({error:'Invalid follow-up filters'});
 const scope=ownClause(req.user);const args=[...scope.params];const where=[scope.sql];
 if(status){args.push(status);where.push(`f.status=$${args.length}`);}
 if(from){args.push(from);where.push(`f.follow_up_date >= $${args.length}::timestamptz`);}
 if(to){args.push(to);where.push(`f.follow_up_date <= $${args.length}::timestamptz`);}
 args.push(limit);
 try{const r=await pool.query(`SELECT f.follow_up_id,f.stay_id,f.patient_id,f.follow_up_date,f.follow_up_type,f.department,f.provider_name,f.status,f.notes,f.created_at
 FROM follow_ups f JOIN ed_stays s ON s.stay_id=f.stay_id WHERE ${where.join(' AND ')} ORDER BY f.follow_up_date ASC NULLS LAST,f.follow_up_id ASC LIMIT $${args.length}`,args);
 res.json({count:r.rowCount,follow_ups:r.rows});}catch(e){console.error('Followups:',e.code||'DB_ERROR');res.status(500).json({error:'Follow-ups unavailable'});}
});
router.get('/prescriptions',auth,auth.requireRole('DOCTOR','ADMIN'),async(req,res)=>{
 const limit=limitParam(req.query.limit);const status=req.query.status||'PENDING_REVIEW';
 if(!limit||!['PENDING_REVIEW','AUTHORIZED','REJECTED'].includes(status))return res.status(400).json({error:'Invalid prescription filters'});
 const scope=ownClause(req.user),params=[...scope.params,status,limit];
 try{const r=await pool.query(`SELECT p.prescription_id,p.stay_id,p.medication_name,p.status,p.prescribed_at,
    a.doctor_user_id AS assigned_doctor_id,dp.full_name AS assigned_doctor_name
 FROM prescriptions p JOIN ed_stays s ON s.stay_id=p.stay_id
 LEFT JOIN LATERAL (SELECT doctor_user_id FROM stay_doctor_assignments WHERE stay_id=s.stay_id AND status='ACTIVE' ORDER BY assignment_id DESC LIMIT 1) a ON TRUE
 LEFT JOIN doctor_profiles dp ON dp.user_id=a.doctor_user_id
 WHERE (${scope.sql}) AND p.status=$${params.length-1}
 ORDER BY p.prescribed_at ASC NULLS LAST,p.prescription_id ASC LIMIT $${params.length}`,params);
 res.json({count:r.rowCount,prescriptions:r.rows});}catch(e){console.error('Prescription queue:',e.code||'DB_ERROR');res.status(500).json({error:'Prescription queue unavailable'});}
});
router.patch('/follow-ups/:follow_up_id',auth,auth.requireRole('ER_STAFF','ADMIN'),async(req,res)=>{
 const id=Number(req.params.follow_up_id);if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'Invalid follow-up id'});
 const {status,follow_up_date}=req.body||{};
 if(status===undefined&&follow_up_date===undefined)return res.status(400).json({error:'No change supplied'});
 if(status!==undefined&&!['SCHEDULED','COMPLETED','CANCELLED','MISSED'].includes(status))return res.status(400).json({error:'Invalid status'});
 if(follow_up_date!==undefined&&(typeof follow_up_date!=='string'||Number.isNaN(Date.parse(follow_up_date))))return res.status(400).json({error:'Invalid date'});
 const client=await pool.connect();let begun=false;
 try{await client.query('BEGIN');begun=true;
 const r=await client.query(`SELECT f.follow_up_id,f.stay_id FROM follow_ups f JOIN ed_stays s ON s.stay_id=f.stay_id WHERE f.follow_up_id=$1 FOR UPDATE OF f`,[id]);
 if(!r.rowCount){await client.query('ROLLBACK');begun=false;return res.status(404).json({error:'Follow-up not found'});}
 if(req.user.role==='ER_STAFF'){const permitted=await client.query(`SELECT 1 FROM emergency_cases WHERE stay_id=$1 AND case_status IN ('ARRIVED_ER','ACTIVE_ER','CLOSED') LIMIT 1`,[r.rows[0].stay_id]);
 if(!permitted.rowCount){await client.query('ROLLBACK');begun=false;return res.status(403).json({error:'Access denied'});}}
 const changed=await client.query(`UPDATE follow_ups SET status=COALESCE($2,status),follow_up_date=COALESCE($3::timestamptz,follow_up_date) WHERE follow_up_id=$1 RETURNING *`,[id,status??null,follow_up_date??null]);
 await client.query('COMMIT');begun=false;res.json({follow_up:changed.rows[0]});
 }catch(e){if(begun)await client.query('ROLLBACK');console.error('Follow-up update:',e.code||'DB_ERROR');res.status(500).json({error:'Unable to update follow-up'});}finally{client.release();}
});
module.exports=router;
