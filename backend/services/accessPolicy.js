// ONE place for all record-level access rules (audit finding F01).
//
//   ADMIN     : everything, but every ADMIN access through the guards is logged
//   PATIENT   : only stays of their own linked patient; no Pre-ER case access.
//               (Hiding unapproved Post-ER records is done in routes/postEr.js)
//               (users.patient_id -> patients.subject_id -> ed_stays.subject_id)
//   PARAMEDIC : only cases they created, and the stay linked to those cases
//   ER_STAFF  : cases that are ARRIVED_ER or ACTIVE_ER, plus CLOSED cases but
//               ONLY on Post-ER routes (requirePostErAccess)
//   DOCTOR    : only stays with an ACTIVE assignment to this doctor
//   other     : nothing
//
// Everything below uses req.user.role from the token. F03 (stale roles) is
// a separate fix.

const pool = require("../db");
const { hasColumn } = require("./schemaCapabilities");

// Policy switch: may a PATIENT open Pre-ER case details (paramedic notes,
// transport, vitals)? Default false. Set true only if you decide they may.
const PATIENT_CAN_VIEW_CASES = false;

const LIVE_ER_STATUSES = ["ARRIVED_ER", "ACTIVE_ER"];

function isPositiveInt(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}


// ---------- "actively assigned doctor": ONE definition for the whole app ----------
// Works with or without stay_doctor_assignments.ended_at.
async function activeAssignmentSql(alias = "") {
  const p = alias ? `${alias}.` : "";
  const hasEndedAt = await hasColumn("stay_doctor_assignments", "ended_at");
  return `${p}status = 'ACTIVE'` + (hasEndedAt ? ` AND ${p}ended_at IS NULL` : "");
}

// db can be the pool or a transaction client (anything with .query).
async function isDoctorActivelyAssigned(db, stayId, doctorUserId) {
  const active = await activeAssignmentSql();
  const r = await db.query(
    `SELECT 1 FROM stay_doctor_assignments
     WHERE stay_id = $1 AND doctor_user_id = $2 AND ${active}
     LIMIT 1`,
    [stayId, doctorUserId]
  );
  return r.rowCount > 0;
}

// ---------- single stay ----------
// options.postEr = true is passed ONLY by Post-ER routes. It lets ER_STAFF
// reach CLOSED cases there (discharge / follow-up work) and nowhere else.
async function canAccessStay(user, stayId, options = {}) {
  if (!user || !isPositiveInt(stayId)) return false;
  if (user.role === "ADMIN") return true;

  if (user.role === "PATIENT") {
    const r = await pool.query(
      `SELECT 1
       FROM users u
       JOIN patients p ON p.patient_id = u.patient_id
       JOIN ed_stays s ON s.subject_id = p.subject_id
       WHERE u.user_id = $1 AND s.stay_id = $2
       LIMIT 1`,
      [user.user_id, stayId]
    );
    return r.rowCount > 0;
  }

  if (user.role === "PARAMEDIC") {
    const r = await pool.query(
      `SELECT 1 FROM emergency_cases
       WHERE stay_id = $1 AND created_by = $2
       LIMIT 1`,
      [stayId, user.user_id]
    );
    return r.rowCount > 0;
  }

  if (user.role === "ER_STAFF") {
    const statuses = options.postEr
      ? [...LIVE_ER_STATUSES, "CLOSED"]
      : LIVE_ER_STATUSES;
    const r = await pool.query(
      `SELECT 1 FROM emergency_cases
       WHERE stay_id = $1 AND case_status = ANY($2)
       LIMIT 1`,
      [stayId, statuses]
    );
    return r.rowCount > 0;
  }

  if (user.role === "DOCTOR") {
    return isDoctorActivelyAssigned(pool, stayId, user.user_id);
  }

  return false;
}

// ---------- single emergency case ----------
// extraErStaffStatuses: extra case statuses ER_STAFF may reach on ONE route.
// Example: er-arrival works on a PRE_ER case, so that route passes ["PRE_ER"].
async function canAccessCase(user, caseId, extraErStaffStatuses = []) {
  if (!user || !isPositiveInt(caseId)) return false;
  if (user.role === "ADMIN") return true;

  if (user.role === "PATIENT") {
    if (!PATIENT_CAN_VIEW_CASES) return false;
    const r = await pool.query(
      `SELECT 1 FROM emergency_cases c
       JOIN users u ON u.patient_id = c.patient_id
       WHERE c.case_id = $1 AND u.user_id = $2
       LIMIT 1`,
      [caseId, user.user_id]
    );
    return r.rowCount > 0;
  }

  if (user.role === "PARAMEDIC") {
    const r = await pool.query(
      `SELECT 1 FROM emergency_cases
       WHERE case_id = $1 AND created_by = $2
       LIMIT 1`,
      [caseId, user.user_id]
    );
    return r.rowCount > 0;
  }

  if (user.role === "ER_STAFF") {
    const r = await pool.query(
      `SELECT 1 FROM emergency_cases
       WHERE case_id = $1 AND case_status = ANY($2)
       LIMIT 1`,
      [caseId, [...LIVE_ER_STATUSES, ...extraErStaffStatuses]]
    );
    return r.rowCount > 0;
  }

  if (user.role === "DOCTOR") {
    const active = await activeAssignmentSql("a");
    const r = await pool.query(
      `SELECT 1
       FROM emergency_cases c
       JOIN stay_doctor_assignments a ON a.stay_id = c.stay_id
       WHERE c.case_id = $1 AND a.doctor_user_id = $2 AND ${active}
       LIMIT 1`,
      [caseId, user.user_id]
    );
    return r.rowCount > 0;
  }

  return false;
}

// ---------- stay LIST filter (same rules as canAccessStay) ----------
// Returns { clause, params } to put after WHERE, with ed_stays aliased as s.
// Parameters start at $1.
async function stayListFilter(user) {
  if (!user) return { clause: "FALSE", params: [] };

  switch (user.role) {
    case "ADMIN":
      return { clause: "TRUE", params: [] };
    case "PATIENT":
      return {
        clause: `s.subject_id IN (
                   SELECT p.subject_id FROM users u
                   JOIN patients p ON p.patient_id = u.patient_id
                   WHERE u.user_id = $1)`,
        params: [user.user_id],
      };
    case "PARAMEDIC":
      return {
        clause: `s.stay_id IN (
                   SELECT stay_id FROM emergency_cases
                   WHERE created_by = $1 AND stay_id IS NOT NULL)`,
        params: [user.user_id],
      };
    case "ER_STAFF":
      return {
        clause: `s.stay_id IN (
                   SELECT stay_id FROM emergency_cases
                   WHERE case_status = ANY($1) AND stay_id IS NOT NULL)`,
        params: [LIVE_ER_STATUSES],
      };
    case "DOCTOR": {
      const active = await activeAssignmentSql();
      return {
        clause: `s.stay_id IN (
                   SELECT stay_id FROM stay_doctor_assignments
                   WHERE doctor_user_id = $1 AND ${active})`,
        params: [user.user_id],
      };
    }
    default:
      return { clause: "FALSE", params: [] };
  }
}

// ---------- Express guards built on the functions above ----------
function logDenied(req, kind, id) {
  console.warn(
    JSON.stringify({
      event: "access_denied",
      kind,
      id,
      user_id: req.user && req.user.user_id,
      role: req.user && req.user.role,
      method: req.method,
      path: req.originalUrl,
    })
  );
}

function logAdminAccess(req, kind, id) {
  console.log(
    JSON.stringify({
      event: "admin_access",
      kind,
      id,
      user_id: req.user.user_id,
      method: req.method,
      path: req.originalUrl,
    })
  );
}

// ADMIN has full access, but every admin access is written to the log (audit).
function logAdminAccess(req, kind, id) {
  if (req.user && req.user.role === "ADMIN") {
    console.log(
      JSON.stringify({
        event: "admin_access",
        kind,
        id,
        user_id: req.user.user_id,
        method: req.method,
        path: req.originalUrl,
      })
    );
  }
}

// Use:  router.get("/:stay_id", authMiddleware, requireStayAccess(), ...)
function requireStayAccess(paramName = "stay_id", options = {}) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params[paramName];
      if (!isPositiveInt(id)) {
        return res.status(400).json({ error: `${paramName} must be a valid integer` });
      }
      if (await canAccessStay(req.user, id, options)) {
        if (req.user.role === "ADMIN") logAdminAccess(req, "stay", id);
        return next();
      }
      logDenied(req, "stay", id);
      return res.status(403).json({ error: "Access denied" });
    } catch (err) {
      console.error("Stay access check error:", err.message);
      return res.status(500).json({ error: "Failed to check access" });
    }
  };
}

// Use:  router.get("/:id", authMiddleware, requireCaseAccess(), ...)
//       er-arrival:  requireCaseAccess("id", ["PRE_ER"])
function requireCaseAccess(paramName = "id", extraErStaffStatuses = []) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params[paramName];
      if (!isPositiveInt(id)) {
        return res.status(400).json({ error: `${paramName} must be a valid integer` });
      }
      if (await canAccessCase(req.user, id, extraErStaffStatuses)) {
        if (req.user.role === "ADMIN") logAdminAccess(req, "case", id);
        return next();
      }
      logDenied(req, "case", id);
      return res.status(403).json({ error: "Access denied" });
    } catch (err) {
      console.error("Case access check error:", err.message);
      return res.status(500).json({ error: "Failed to check access" });
    }
  };
}

// Use on Post-ER routes only: same as requireStayAccess() but ER_STAFF may
// also reach CLOSED cases.
function requirePostErAccess(paramName = "stay_id") {
  return requireStayAccess(paramName, { postEr: true });
}

module.exports = {
  canAccessStay,
  requirePostErAccess,
  canAccessCase,
  stayListFilter,
  isDoctorActivelyAssigned,
  requireStayAccess,
  requireCaseAccess,
  PATIENT_CAN_VIEW_CASES,
};
