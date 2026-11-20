'use strict';
const pool = require('../db');
// Deliberately only fields constructed by clinicalAudit.createAuditEvent.
// No URLs, record IDs, headers, JWTs, request body, response body or free text.
async function persistAuditEvent(e) {
  if (!e || e.event !== 'clinical_api_access') return;
  await pool.query(`INSERT INTO public.clinical_audit_events
    (audit_id,occurred_at,actor_id,actor_role,action,resource_type,status_code,outcome)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (audit_id) DO NOTHING`,
    [e.audit_id,e.at,e.actor_id,e.actor_role,e.action,e.resource_type,e.status_code,e.outcome]);
}
module.exports = { persistAuditEvent };
