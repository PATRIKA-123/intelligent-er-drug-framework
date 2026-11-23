'use strict';
// Read-only PRE_ER handover lookup. Mounted before the existing case routers.
// This intentionally does NOT grant ER staff write access to paramedic data.
const express = require('express');
const pool = require('../db');
const auth = require('../middleware/authMiddleware');
const router = express.Router();
router.use(auth);
const valid = value => /^\d{1,9}$/.test(String(value)) && Number(value) > 0;
async function preErCase(req, res, next) {
  if(req.user.role !== 'ER_STAFF') return next('route');
  if (!valid(req.params.id)) return res.status(400).json({error:'Invalid case ID'});
  try {
    const found = await pool.query('SELECT case_id,temporary_case_code,case_status,stay_id FROM public.emergency_cases WHERE case_id=$1',[req.params.id]);
    if (!found.rowCount) return res.status(404).json({error:'Case not found'});
    // Other statuses follow the existing application access policies.
    if (found.rows[0].case_status !== 'PRE_ER') return next('route');
    req.incomingCase = found.rows[0]; return next();
  } catch(err){console.error('Incoming case lookup:',err.code||'DB_ERROR');return res.status(500).json({error:'Could not load incoming case'});}
}
router.get('/:id/workflow',preErCase,async(req,res)=>{
  try {
    const id = Number(req.params.id);
    const [assessment,vital,transport] = await Promise.all([
      pool.query('SELECT * FROM public.pre_er_assessments WHERE case_id=$1 ORDER BY assessment_time DESC NULLS LAST,assessment_id DESC LIMIT 1',[id]),
      pool.query('SELECT * FROM public.pre_er_vitals WHERE case_id=$1 ORDER BY recorded_at DESC NULLS LAST,vital_id DESC LIMIT 1',[id]),
      pool.query('SELECT * FROM public.ambulance_transports WHERE case_id=$1 ORDER BY created_at DESC NULLS LAST,transport_id DESC LIMIT 1',[id])
    ]);
    // Do not manufacture a clinical risk score from incomplete input. An ER
    // clinician can review the recorded vital measurements directly.
    return res.json({case_id:id,case:req.incomingCase,linked_stay_id:req.incomingCase.stay_id,
      latest_assessment:assessment.rows[0]||null,latest_vital:vital.rows[0]||null,transport:transport.rows[0]||null,
      clinical_risk:{status:'incomplete',message:'Risk scoring must be verified from the complete clinical data.'}});
  }catch(err){console.error('Incoming workflow:',err.code||'DB_ERROR');return res.status(500).json({error:'Could not load incoming handover'});}
});
router.get('/:id/vitals',preErCase,async(req,res)=>{
  try {const r=await pool.query('SELECT * FROM public.pre_er_vitals WHERE case_id=$1 ORDER BY recorded_at DESC NULLS LAST,vital_id DESC LIMIT 200',[req.params.id]);return res.json({vitals:r.rows});}
  catch(err){console.error('Incoming vitals:',err.code||'DB_ERROR');return res.status(500).json({error:'Could not load incoming vitals'});}
});
module.exports=router;
