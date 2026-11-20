'use strict';
const express=require('express');const pool=require('../db');const auth=require('../middleware/authMiddleware');
const router=express.Router();
router.get('/',auth,auth.requireRole('ER_STAFF','ADMIN','DOCTOR'),async(req,res)=>{
 const limit=req.query.limit===undefined?50:Number(req.query.limit);const status=req.query.status||'OPEN';
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!['OPEN','ACTIVE','RESOLVED'].includes(status))return res.status(400).json({error:'Invalid alert filter'});
 let clause='TRUE',params=[];
 if(req.user.role==='DOCTOR'){clause="EXISTS(SELECT 1 FROM stay_doctor_assignments a WHERE a.stay_id=s.stay_id AND a.doctor_user_id=$1 AND a.status='ACTIVE')";params.push(req.user.user_id);}
 if(req.user.role==='ER_STAFF')clause="EXISTS(SELECT 1 FROM emergency_cases c WHERE c.stay_id=s.stay_id AND c.case_status IN ('ARRIVED_ER','ACTIVE_ER','CLOSED'))";
 params.push(status==='OPEN'?'ACTIVE':status,limit);
 try{const r=await pool.query(`SELECT a.alert_id,a.stay_id,a.severity,a.alert_message,a.created_at,a.status,a.engine_run_id FROM clinical_alerts a JOIN ed_stays s ON s.stay_id=a.stay_id
 WHERE (${clause}) AND a.status=$${params.length-1}
 AND NOT EXISTS(SELECT 1 FROM public.screening_runs sr WHERE sr.stay_id=a.stay_id AND sr.engine_run_id<>a.engine_run_id AND sr.status LIKE 'COMPLETE_%' AND sr.started_at>(SELECT started_at FROM public.screening_runs WHERE engine_run_id=a.engine_run_id))
 ORDER BY a.created_at DESC,a.alert_id DESC LIMIT $${params.length}`,params);
 res.json({count:r.rowCount,alerts:r.rows});}catch(e){console.error('Alerts queue:',e.code||'DB_ERROR');res.status(500).json({error:'Alerts queue unavailable'});}
});
module.exports=router;
