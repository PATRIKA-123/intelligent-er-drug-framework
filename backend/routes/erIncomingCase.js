"use strict";
// Separate read-only hospital intake API. It intentionally does not change
// paramedic ownership or allow ER staff to edit pre-hospital case records.
const express = require("express");
const pool = require("../db");
const auth = require("../middleware/authMiddleware");
const router = express.Router();
router.use(auth, auth.requireRole("ER_STAFF", "ADMIN"));
router.get("/:id", async (req,res) => {
  if (!/^\d{1,9}$/.test(req.params.id) || Number(req.params.id) < 1)
    return res.status(400).json({ error: "Invalid ambulance case ID" });
  const id = Number(req.params.id);
  try {
    const r = await pool.query(`SELECT case_id, temporary_case_code, case_status, stay_id,
      patient_id, created_at FROM public.emergency_cases WHERE case_id=$1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: "Ambulance case not found" });
    const c=r.rows[0];
    const [a,v,t] = await Promise.all([
      pool.query(`SELECT chief_complaint,consciousness_status,allergy_status,current_medications,assessment_time
        FROM public.pre_er_assessments WHERE case_id=$1 ORDER BY assessment_time DESC NULLS LAST,assessment_id DESC LIMIT 1`, [id]),
      pool.query(`SELECT vital_id,heart_rate,respiratory_rate,systolic_bp,diastolic_bp,spo2,
        temperature,oxygen_support,consciousness_level,recorded_at
        FROM public.pre_er_vitals WHERE case_id=$1 ORDER BY recorded_at DESC NULLS LAST,vital_id DESC LIMIT 1`,[id]),
      pool.query(`SELECT ambulance_id,destination_hospital,transport_status,created_at
        FROM public.ambulance_transports WHERE case_id=$1 ORDER BY created_at DESC NULLS LAST,transport_id DESC LIMIT 1`,[id]),
    ]);
    const vital=v.rows[0]||null;
    if (vital) vital.temperature_celsius=vital.temperature;
    return res.json({case_id:c.case_id,temporary_case_code:c.temporary_case_code,status:c.case_status,
      stay_id:c.stay_id,created_at:c.created_at,latest_assessment:a.rows[0]||null,
      latest_vital:vital,transport:t.rows[0]||null,
      // A previous pre-hospital NEWS2 calculation is not an ER diagnosis.
      news2:{complete:false,message:"Clinician should review the recorded vitals."},
    });
  } catch(err) {
    console.error("ER incoming lookup error",err.code||"DB_ERROR");
    return res.status(500).json({error:"Unable to read incoming ambulance case"});
  }
});
module.exports=router;
