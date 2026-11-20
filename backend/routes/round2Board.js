'use strict';
const express=require('express');
const pool=require('../db');
const auth=require('../middleware/authMiddleware');
const {stayListFilter}=require('../services/accessPolicy');
const router=express.Router();
router.get('/',auth,auth.requireRole('DOCTOR','ER_STAFF','ADMIN'),async(req,res)=>{
  const limit=req.query.limit===undefined?50:Number(req.query.limit);
  const offset=req.query.offset===undefined?0:Number(req.query.offset);
  const sort=req.query.sort||'risk';
  const risk=req.query.risk||null,status=req.query.status||null,q=req.query.q||null;
  const include=req.query.include||null;
  if(!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0||!['risk','time'].includes(sort)||
     (include!==null&&include!=='all')||(risk!==null&&!['High','Medium','Low-Medium','Low'].includes(risk))||
     (status!==null&&!['PRE_ER','ARRIVED_ER','ACTIVE_ER','CLOSED'].includes(status))||
     (q!==null&&(typeof q!=='string'||q.length>100)))return res.status(400).json({error:'Invalid board filters',code:'VALIDATION_ERROR'});
  try{
    const {clause,params}=await stayListFilter(req.user);
    const values=[...params]; const conditions=[`(${clause})`];
    if(include!=='all')conditions.push("(s.visit_status IS NULL OR s.visit_status <> 'DEPARTED')");
    if(status){values.push(status);conditions.push(`ec.case_status = $${values.length}`);}
    if(risk){values.push(risk);conditions.push(`nw.risk_level ILIKE $${values.length} || '%'`);}
    if(q){values.push(`%${q.replace(/[\\%_]/g,'\\$&')}%`);conditions.push(`(s.stay_id::text ILIKE $${values.length} ESCAPE '\\' OR s.chiefcomplaint ILIKE $${values.length} ESCAPE '\\')`);}
    const where=conditions.join(' AND ');
    const joins=`LEFT JOIN LATERAL (SELECT case_status,temporary_case_code FROM emergency_cases WHERE stay_id=s.stay_id ORDER BY created_at DESC,case_id DESC LIMIT 1) ec ON TRUE
       LEFT JOIN LATERAL (SELECT t.total_news2_score,t.risk_level,t.observation_time FROM (
          SELECT n.total_news2_score,n.risk_level,n.observation_time FROM news2_results_real n WHERE n.stay_id=s.stay_id
          UNION ALL SELECT v.news2_score,v.risk_level,v.observation_time FROM er_vital_entries v WHERE v.stay_id=s.stay_id AND v.scoring_status='COMPLETED'
       ) t ORDER BY t.observation_time DESC LIMIT 1) nw ON TRUE
       LEFT JOIN LATERAL (SELECT o.observation_time,o.heart_rate,o.respiratory_rate,o.spo2,o.systolic_bp,o.temperature_celsius FROM (
          SELECT observation_time,heart_rate,respiratory_rate,spo2,systolic_bp,temperature_celsius FROM er_vital_entries WHERE stay_id=s.stay_id
          UNION ALL SELECT observation_time,heart_rate,respiratory_rate,spo2,systolic_bp,NULL::numeric AS temperature_celsius FROM observations WHERE stay_id=s.stay_id
       ) o ORDER BY o.observation_time DESC LIMIT 1) ob ON TRUE
       LEFT JOIN LATERAL (SELECT a.doctor_user_id AS user_id,dp.full_name FROM stay_doctor_assignments a JOIN doctor_profiles dp ON dp.user_id=a.doctor_user_id WHERE a.stay_id=s.stay_id AND a.status='ACTIVE' ORDER BY a.assignment_id DESC LIMIT 1) doc ON TRUE`;
    const total=Number((await pool.query(`SELECT count(*)::int AS n FROM ed_stays s ${joins} WHERE ${where}`,values)).rows[0].n);
    values.push(limit,offset);
    const order=sort==='time'?'s.intime DESC NULLS LAST, s.stay_id DESC':`CASE WHEN nw.risk_level ILIKE 'High%' THEN 0 WHEN nw.risk_level ILIKE 'Medium%' THEN 1 WHEN nw.risk_level ILIKE 'Low-Medium%' THEN 2 WHEN nw.risk_level ILIKE 'Low%' THEN 3 ELSE 4 END, s.intime DESC NULLS LAST, s.stay_id DESC`;
    const rows=(await pool.query(`SELECT s.stay_id,s.subject_id,s.intime,s.outtime,s.gender,s.disposition,s.chiefcomplaint,s.acuity,s.visit_status,
       ec.temporary_case_code AS case_code,ec.case_status,nw.total_news2_score,nw.risk_level,nw.observation_time AS score_time,
       to_jsonb(ob) AS latest_observation,to_jsonb(doc) AS assigned_doctor
       FROM ed_stays s ${joins} WHERE ${where} ORDER BY ${order} LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
    const stays=rows.map(({total_news2_score,risk_level,score_time,...r})=>({...r,latest_news2:score_time?{
      total_news2_score,risk_level,minutes_ago:Math.max(0,Math.floor((Date.now()-new Date(score_time).getTime())/60000)),
      provenance_status:'UNVERIFIED_FRESHNESS'}:null}));
    res.json({count:stays.length,total,limit,offset,stays});
  }catch(e){console.error('Round2 board error:',e.code||'DB_ERROR');res.status(500).json({error:'Board unavailable',code:'INTERNAL_ERROR'});}
});
module.exports=router;
