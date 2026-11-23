'use strict';
// Admin-only operations. Do not expose clinical data to non-admin roles.
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');
const auth = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/mailer');
const inv = require('../services/invitationService');
const router = express.Router();
const publicRouter = express.Router();
const intId = (x) => /^\d{1,9}$/.test(String(x)) && Number(x) > 0 ? Number(x) : null;
const fail = (res, e, msg) => { console.error('Admin management:', e.code || e.message); return res.status(500).json({ error: msg }); };
const audit = (client, actor, action, targetType, targetId, reason = null) =>
  client.query(`INSERT INTO admin_action_audit(actor_user_id,action,target_type,target_id,reason)
                VALUES ($1,$2,$3,$4,$5)`, [actor, action, targetType, String(targetId), reason]);
const expiryStatus = (row) => row.accepted_at ? 'ACCEPTED' : row.revoked_at ? 'REVOKED' : new Date(row.expires_at) <= new Date() ? 'EXPIRED' : 'PENDING';
router.use(auth, auth.requireRole('ADMIN'));

// Invitations include all historical attempts; never reveal token hashes.
router.get('/invitations', async (req, res) => {
  try {
    const r = await pool.query(`SELECT di.invitation_id,di.user_id,di.created_at,di.expires_at,di.accepted_at,di.revoked_at,
      u.username,u.email,u.role,u.is_active,COALESCE(dp.full_name,sp.full_name,u.username) AS full_name
      FROM doctor_invitations di JOIN users u ON u.user_id=di.user_id
      LEFT JOIN doctor_profiles dp ON dp.user_id=u.user_id
      LEFT JOIN staff_profiles sp ON sp.user_id=u.user_id
      WHERE u.role IN ('DOCTOR','ER_STAFF','PARAMEDIC')
      ORDER BY di.created_at DESC,di.invitation_id DESC LIMIT 500`);
    res.json({ invitations: r.rows.map(row => ({ ...row, status: expiryStatus(row) })) });
  } catch (e) { fail(res, e, 'Failed to load invitations'); }
});

// Directory includes patient accounts, but never password hashes.
router.get('/users', async (req, res) => {
  try {
    const r = await pool.query(`SELECT u.user_id,u.username,u.email,u.role,u.is_active,u.created_at,
      COALESCE(dp.full_name,sp.full_name,pp.full_name,u.username) AS full_name,
      dp.specialization,
      (SELECT MAX(di.accepted_at) FROM doctor_invitations di WHERE di.user_id=u.user_id) AS accepted_at
      FROM users u LEFT JOIN doctor_profiles dp ON dp.user_id=u.user_id
      LEFT JOIN staff_profiles sp ON sp.user_id=u.user_id
      LEFT JOIN patient_profiles pp ON pp.user_id=u.user_id
      ORDER BY u.created_at DESC NULLS LAST,u.user_id DESC LIMIT 1000`);
    res.json({ users: r.rows });
  } catch (e) { fail(res, e, 'Failed to load users'); }
});

router.patch('/users/:id/status', async (req, res) => {
  const id = intId(req.params.id), active = req.body?.is_active, reason = req.body?.reason;
  if (!id || typeof active !== 'boolean' || typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 500)
    return res.status(400).json({error: 'A status and reason of 8–500 characters are required'});
  if (id === req.user.user_id) return res.status(403).json({error: 'You cannot change your own account status'});
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const found = await c.query('SELECT user_id,role,is_active FROM users WHERE user_id=$1 FOR UPDATE',[id]);
    if (!found.rowCount) { await c.query('ROLLBACK'); return res.status(404).json({error: 'User not found'}); }
    if (found.rows[0].role === 'ADMIN') { await c.query('ROLLBACK'); return res.status(403).json({error: 'Admin accounts cannot be changed here'}); }
    if (!found.rows[0].is_active && active) {
      // Never bypass the invited user's initial password setup.
      const used = await c.query('SELECT 1 FROM doctor_invitations WHERE user_id=$1 LIMIT 1',[id]);
      const accepted = await c.query('SELECT 1 FROM doctor_invitations WHERE user_id=$1 AND accepted_at IS NOT NULL LIMIT 1',[id]);
      if (used.rowCount && !accepted.rowCount) { await c.query('ROLLBACK'); return res.status(409).json({error: 'An unaccepted invitation must be accepted first'}); }
    }
    await c.query('UPDATE users SET is_active=$2 WHERE user_id=$1',[id,active]);
    await audit(c,req.user.user_id,active?'USER_REACTIVATED':'USER_DEACTIVATED','USER',id,reason.trim());
    await c.query('COMMIT'); return res.json({message: active?'Account reactivated':'Account deactivated'});
  } catch(e) { await c.query('ROLLBACK').catch(()=>{}); return fail(res,e,'Failed to update account'); }
  finally { c.release(); }
});

// Only unused, never-activated invites may be hard-deleted (delegates to existing guarded endpoints).
// Password reset: send an expiring, one-time link. Never email a plaintext password.
router.post('/users/:id/password-reset', async (req,res) => {
  const id=intId(req.params.id);
  if(!id) return res.status(400).json({error:'Invalid user ID'});
  if(id===req.user.user_id) return res.status(403).json({error:'Use a self-service password change for your own account'});
  const {base,error}=inv.getInvitationBaseUrl();if(error)return res.status(500).json({error});
  let token,requestId,user;
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const q=await c.query(`SELECT u.user_id,u.email,u.username,u.role,u.is_active FROM users u
      WHERE u.user_id=$1 AND u.role IN ('DOCTOR','ER_STAFF','PARAMEDIC') FOR UPDATE`,[id]);
    user=q.rows[0];
    if(!user) { await c.query('ROLLBACK'); return res.status(404).json({error:'User not found'}); }
    if(!user.is_active || !user.email) { await c.query('ROLLBACK'); return res.status(409).json({error:'Only active accounts with a verified email address can receive a reset'}); }
    const accepted = await c.query('SELECT 1 FROM doctor_invitations WHERE user_id=$1 AND accepted_at IS NOT NULL LIMIT 1',[id]);
    if(!accepted.rowCount) { await c.query('ROLLBACK'); return res.status(409).json({error:'The staff member must accept their invitation before a password reset is available'}); }
    await c.query('UPDATE admin_password_resets SET revoked_at=NOW() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',[id]);
    token=crypto.randomBytes(32).toString('hex');
    const q2=await c.query(`INSERT INTO admin_password_resets(user_id,token_hash,created_by,expires_at)
      VALUES($1,$2,$3,NOW()+INTERVAL '30 minutes') RETURNING reset_id`,[id,inv.hashToken(token),req.user.user_id]);
    requestId=q2.rows[0].reset_id;
    await audit(c,req.user.user_id,'PASSWORD_RESET_SENT','USER',id,'Email-verified self-service reset');
    await c.query('COMMIT');
  } catch(e) { await c.query('ROLLBACK').catch(()=>{});return fail(res,e,'Unable to create reset request'); }
  finally { c.release(); }
  const url=new URL('/reset-password',base);url.searchParams.set('token',token);
  try {
    await sendEmail({to:user.email,subject:'Parvah password reset',html:`<p>Hello ${inv.escapeHtml(user.username)},</p><p>An administrator requested a password reset for your Parvah account.</p><p><a href="${url.toString()}">Set a new password</a></p><p>This one-time link expires in 30 minutes. If this was unexpected, contact your administrator.</p>`});
  } catch(e) {
    await pool.query('UPDATE admin_password_resets SET revoked_at=NOW() WHERE reset_id=$1',[requestId]).catch(()=>{});
    return fail(res,e,'Password reset email could not be sent');
  }
  return res.json({message:'Password reset link sent to the account email'});
});

router.get('/operations', async (req,res)=>{
  try {
    const [cases, stays] = await Promise.all([
      pool.query(`SELECT c.case_id,c.temporary_case_code,c.case_status,c.stay_id,c.created_at,c.created_by,
        u.username AS paramedic_username,sp.full_name AS paramedic_name,
        a.chief_complaint FROM emergency_cases c
        LEFT JOIN users u ON u.user_id=c.created_by
        LEFT JOIN staff_profiles sp ON sp.user_id=c.created_by
        LEFT JOIN LATERAL (SELECT chief_complaint FROM pre_er_assessments
          WHERE case_id=c.case_id ORDER BY assessment_time DESC NULLS LAST,assessment_id DESC LIMIT 1) a ON TRUE
        WHERE c.case_status<>'CLOSED' ORDER BY c.created_at DESC LIMIT 1000`),
      pool.query(`SELECT s.stay_id,s.intime,s.visit_status,s.chiefcomplaint,s.acuity,
        p.full_name AS patient_name, p.subject_id,
        d.doctor_user_id,d.full_name AS doctor_name,d.specialization,
        ec.case_id,ec.case_status,ec.temporary_case_code
        FROM ed_stays s LEFT JOIN patients p ON p.subject_id=s.subject_id
        LEFT JOIN LATERAL (SELECT a.doctor_user_id,dp.full_name,dp.specialization
          FROM stay_doctor_assignments a JOIN doctor_profiles dp ON dp.user_id=a.doctor_user_id
          WHERE a.stay_id=s.stay_id AND a.status='ACTIVE' AND a.ended_at IS NULL
          ORDER BY a.assignment_id DESC LIMIT 1) d ON TRUE
        LEFT JOIN LATERAL (SELECT case_id,case_status,temporary_case_code FROM emergency_cases
          WHERE stay_id=s.stay_id ORDER BY created_at DESC,case_id DESC LIMIT 1) ec ON TRUE
        WHERE s.visit_status IS NULL OR s.visit_status<>'DEPARTED'
        ORDER BY s.intime DESC NULLS LAST LIMIT 1000`)
    ]);
    res.json({cases:cases.rows,stays:stays.rows});
  }catch(e){fail(res,e,'Failed to load operational overview');}
});

// Destructive operation ONLY for empty PRE_ER placeholders. Real clinical cases must be retained.
router.delete('/cases/:id', async(req,res)=>{
  const id=intId(req.params.id),reason=req.body?.reason;
  if(!id || typeof reason!=='string' || reason.trim().length<10 || reason.length>500)
    return res.status(400).json({error:'Case ID and a reason of 10–500 characters are required'});
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const x=await c.query('SELECT * FROM emergency_cases WHERE case_id=$1 FOR UPDATE',[id]);
    const one=x.rows[0];
    if(!one){await c.query('ROLLBACK');return res.status(404).json({error:'Case not found'});}
    if(one.case_status!=='PRE_ER' || one.stay_id!==null || one.patient_id!==null){
      await c.query('ROLLBACK');return res.status(409).json({error:'Only an unlinked PRE_ER placeholder can be deleted'});
    }
    const [assess,transport,vitals]=await Promise.all([
      c.query('SELECT 1 FROM pre_er_assessments WHERE case_id=$1 LIMIT 1',[id]),
      c.query('SELECT 1 FROM ambulance_transports WHERE case_id=$1 LIMIT 1',[id]),
      c.query('SELECT 1 FROM pre_er_vitals WHERE case_id=$1 LIMIT 1',[id])
    ]);
    if(assess.rowCount||transport.rowCount||vitals.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'This case has clinical or transport records and cannot be deleted'});}
    // If other dependent tables exist, their foreign keys fail closed.
    await audit(c,req.user.user_id,'EMPTY_CASE_DELETED','CASE',id,`${reason.trim()} | code: ${one.temporary_case_code}`);
    await c.query('DELETE FROM emergency_cases WHERE case_id=$1',[id]);
    await c.query('COMMIT');return res.json({message:'Empty placeholder deleted; audit record retained'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e.code==='23503')return res.status(409).json({error:'This case has related records and cannot be deleted'});return fail(res,e,'Unable to delete case');}
  finally{c.release();}
});

// Public token validation and completion, rate limit advised at edge; tokens are 256-bit secrets.
publicRouter.post('/validate-reset',async(req,res)=>{
  const token=req.body?.token;
  if(typeof token!=='string'|| !/^[0-9a-f]{64}$/.test(token)) return res.status(400).json({error:'Invalid reset link'});
  try {const r=await pool.query(`SELECT u.username FROM admin_password_resets t JOIN users u ON u.user_id=t.user_id
    WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>NOW() AND u.is_active=TRUE`,[inv.hashToken(token)]);
    if(!r.rowCount)return res.status(410).json({error:'Reset link expired or already used'});
    res.json({username:r.rows[0].username});
  }catch(e){fail(res,e,'Unable to validate reset');}
});
publicRouter.post('/complete-reset',async(req,res)=>{
  const {token,password}=req.body||{};
  if(typeof token!=='string'|| !/^[0-9a-f]{64}$/.test(token)|| typeof password!=='string'||password.length<12||password.length>128)
    return res.status(400).json({error:'Valid token and password of 12–128 characters required'});
  const hash=await bcrypt.hash(password,10);
  const c=await pool.connect();
  try {await c.query('BEGIN');
    const r=await c.query(`SELECT t.reset_id,t.user_id FROM admin_password_resets t JOIN users u ON u.user_id=t.user_id
      WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>NOW() AND u.is_active=TRUE FOR UPDATE OF t`,[inv.hashToken(token)]);
    if(!r.rowCount){await c.query('ROLLBACK');return res.status(410).json({error:'Reset link expired or already used'});}
    const item=r.rows[0];
    await c.query('UPDATE users SET password_hash=$2 WHERE user_id=$1',[item.user_id,hash]);
    await c.query('UPDATE admin_password_resets SET used_at=NOW() WHERE reset_id=$1',[item.reset_id]);
    await audit(c,null,'PASSWORD_RESET_COMPLETED','USER',item.user_id,'One-time reset link');
    await c.query('COMMIT');res.json({message:'Password changed successfully. Please sign in.'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});fail(res,e,'Unable to reset password');}finally{c.release();}
});
// Aggregate analytics use COUNT queries, not truncated operational lists.
router.get('/summary', async (_req,res)=>{
 try{
  const [users, invites, cases, stays]=await Promise.all([
   pool.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE is_active)::int AS active,
     COUNT(*) FILTER(WHERE role='DOCTOR')::int AS doctors,
     COUNT(*) FILTER(WHERE role='ER_STAFF')::int AS er_staff,
     COUNT(*) FILTER(WHERE role='PARAMEDIC')::int AS paramedics,
     COUNT(*) FILTER(WHERE role='PATIENT')::int AS patients FROM public.users`),
   pool.query(`SELECT COUNT(*) FILTER(WHERE accepted_at IS NOT NULL)::int AS accepted,
     COUNT(*) FILTER(WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW())::int AS pending,
     COUNT(*) FILTER(WHERE accepted_at IS NULL AND (revoked_at IS NOT NULL OR expires_at<=NOW()))::int AS other FROM public.doctor_invitations`),
   pool.query(`SELECT COUNT(*)::int AS open FROM public.emergency_cases WHERE case_status<>'CLOSED'`),
   pool.query(`SELECT COUNT(*)::int AS current,
     COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.stay_doctor_assignments a
       WHERE a.stay_id=s.stay_id AND a.status='ACTIVE' AND a.ended_at IS NULL))::int AS assigned
     FROM public.ed_stays s WHERE s.visit_status IS NULL OR s.visit_status<>'DEPARTED'`)
  ]);
  res.json({users_total:users.rows[0].total,users_active:users.rows[0].active,
    doctors:users.rows[0].doctors,er_staff:users.rows[0].er_staff,paramedics:users.rows[0].paramedics,patients:users.rows[0].patients,
    invites_accepted:invites.rows[0].accepted,invites_pending:invites.rows[0].pending,invites_other:invites.rows[0].other,
    cases_open:cases.rows[0].open,stays_current:stays.rows[0].current,stays_assigned:stays.rows[0].assigned});
 }catch(e){fail(res,e,'Unable to load admin analytics');}
});
module.exports={router,publicRouter};
