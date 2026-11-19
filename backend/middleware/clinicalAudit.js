"use strict";
const { randomUUID } = require("node:crypto");

// B26: minimal, redacted event stream for an external log collector.
// A durable, tamper-evident audit table/retention policy is a separate DB task.
const PREFIXES = [
  ["/api/stays", "stay"],
  ["/api/emergency-cases", "emergency_case"],
  ["/api/clinical-context", "clinical_context"],
  ["/api/clinical-summary", "clinical_summary"],
  ["/api/decision-support", "decision_support"],
  ["/api/clinical-permissions", "clinical_permission"],
  ["/api/post-er", "post_er"],
];
function resourceType(pathname) {
  if (typeof pathname !== "string") return null;
  const base = pathname.split("?")[0];
  for (const [prefix, type] of PREFIXES) {
    if (base === prefix || base.startsWith(prefix + "/")) return type;
  }
  return null;
}
function outcome(status) {
  if (status === 401 || status === 403) return "DENIED";
  if (status >= 500) return "ERROR";
  if (status >= 400) return "REJECTED";
  return "ALLOWED";
}
function createAuditEvent({ method, pathname, statusCode, user, id }) {
  const type = resourceType(pathname);
  if (!type) return null;
  const status = Number.isInteger(statusCode) ? statusCode : 500;
  return {
    event: "clinical_api_access",
    audit_id: typeof id === "string" && /^[0-9a-f-]{36}$/.test(id) ? id : randomUUID(),
    at: new Date().toISOString(),
    actor_id: Number.isSafeInteger(Number(user?.user_id)) && Number(user.user_id) > 0 ? Number(user.user_id) : null,
    actor_role: ["ADMIN", "DOCTOR", "ER_STAFF", "PARAMEDIC", "PATIENT"].includes(user?.role) ? user.role : null,
    action: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "OTHER",
    resource_type: type,
    status_code: status,
    outcome: outcome(status),
  };
}
function clinicalAudit(req, res, next) {
  const pathname = req.path || req.originalUrl || "";
  if (!resourceType(pathname)) return next();
  const id = randomUUID();
  res.once("finish", () => {
    // Never log request URL, query, headers, JWT, request/response body or record ID.
    const e = createAuditEvent({ method: req.method, pathname, statusCode: res.statusCode, user: req.user, id });
    if (e) console.info(JSON.stringify(e));
  });
  next();
}
module.exports = { clinicalAudit, resourceType, createAuditEvent };
