"use strict";
const express=require('express');
const pool=require('../db');
const auth=require('../middleware/authMiddleware');
const router=express.Router();
router.use(auth,auth.requireRole('ADMIN'));
// History is READ-ONLY. Physical deletion records can only be audited, not restored.
router.get('/history',async(req,res)=>{
 try {
  const [users,cases,events,invites]=await Promise.all([
   pool.query(`SELECT u.user_id,u.username,u.email,u.role,u.created_at,u.archived_at,
      COALESCE(dp.full_name,sp.full_name,pp.full_name,u.username) AS full_name
      FROM public.users u
      LEFT JOIN public.doctor_profiles dp ON dp.user_id=u.user_id
      LEFT JOIN public.staff_profiles sp ON sp.user_id=u.user_id
      LEFT JOIN public.patient_profiles pp ON pp.user_id=u.user_id
      WHERE u.archived_at IS NOT NULL ORDER BY u.archived_at DESC LIMIT 250`),
   pool.query(`SELECT c.case_id,c.temporary_case_code,c.case_status,c.stay_id,c.created_at,
      u.username AS creator,
      (SELECT COUNT(*)::integer FROM public.pre_er_assessments a WHERE a.case_id=c.case_id) AS assessments,
      (SELECT COUNT(*)::integer FROM public.pre_er_vitals v WHERE v.case_id=c.case_id) AS vitals,
      (SELECT COUNT(*)::integer FROM public.ambulance_transports t WHERE t.case_id=c.case_id) AS transports
      FROM public.emergency_cases c LEFT JOIN public.users u ON u.user_id=c.created_by
      WHERE c.case_status='CLOSED' ORDER BY c.created_at DESC LIMIT 250`),
   pool.query(`SELECT audit_id,action,target_type,target_id,reason,created_at,
     actor_user_id FROM public.admin_action_audit
     ORDER BY created_at DESC,audit_id DESC LIMIT 250`),
   pool.query(`SELECT i.invitation_id,i.user_id,u.username,u.role,i.created_at,i.accepted_at,i.revoked_at,i.expires_at
     FROM public.doctor_invitations i JOIN public.users u ON u.user_id=i.user_id
     WHERE i.accepted_at IS NOT NULL OR i.revoked_at IS NOT NULL OR i.expires_at <= NOW()
     ORDER BY i.created_at DESC,i.invitation_id DESC LIMIT 250`),
  ]);
  return res.json({archived_accounts:users.rows,closed_cases:cases.rows,
    audit_events:events.rows,invitation_history:invites.rows,
    caps:{archived_accounts:250,closed_cases:250,audit_events:250,invitation_history:250},
    notes:{closed_cases:'Closed cases are retained clinical records, not archived or deleted cases.',
    audit_events:'Deleted data is not recoverable here; only the retained audit log is shown.'}});
 } catch(err){console.error('Admin history:',err.code||'DB_ERROR');return res.status(500).json({error:'Unable to load admin history'});}
});
module.exports=router;
