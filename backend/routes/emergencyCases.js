const express = require("express");

const router = express.Router();

const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { isValidCaseId, isValidPatientId } = require("../validators/idValidator");
const { textFieldError } = require("../validators/textValidator");
const { requireCaseAccess } = require("../services/accessPolicy");
const CASE_TEXT_MAX_LENGTH = 30;

// POST /api/emergency-cases
// Creates a new emergency case.
// Only PARAMEDIC and ADMIN may create one.

router.post(
  "/",
  authMiddleware,
  authMiddleware.requireRole("PARAMEDIC", "ADMIN"),
  async (req, res) => {
    try {
      const { temporary_case_code, patient_id } = req.body;

      // source is optional
     const rawSource = req.body.source;
const source =
  rawSource === undefined || rawSource === null
    ? "APPLICATION"
    : rawSource;

      // temporary_case_code is required
      if (!temporary_case_code) {
        return res.status(400).json({
          error: "temporary_case_code is required",
        });
      }

      // patient_id is optional (missing or null is allowed). When it is given it
      // must be an integer that fits the integer column; otherwise PostgreSQL
      // rejects it and this route used to answer HTTP 500 instead of 400.
      if (
        patient_id !== undefined &&
        patient_id !== null &&
        !isValidPatientId(patient_id)
      ) {
        return res.status(400).json({
          error: "patient_id must be a valid integer",
        });
      }

     const textError =
  textFieldError(
    "temporary_case_code",
    temporary_case_code,
    CASE_TEXT_MAX_LENGTH
  ) ||
  textFieldError(
    "source",
    source,
    CASE_TEXT_MAX_LENGTH
  );

if (textError) {
  return res.status(400).json({
    error: textError,
  });
}

      // created_by ALWAYS comes from the authenticated JWT.
      // It is never taken from the request body.
      const createdBy = req.user.user_id;

      const result = await pool.query(
        `INSERT INTO emergency_cases
          (temporary_case_code, patient_id, source, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING
           case_id,
           patient_id,
           stay_id,
           temporary_case_code,
           case_status,
           source,
           created_by,
           created_at`,
        [
          temporary_case_code,
          patient_id ?? null,
          source,
          createdBy,
        ]
      );

      return res.status(201).json({
        message: "Emergency case created successfully",
        case: result.rows[0],
      });
    } catch (err) {
      // Foreign-key violation
      // Expected mainly when patient_id does not exist.
      if (
        err.code === "23503" &&
        err.constraint === "emergency_cases_patient_id_fkey"
      ) {
        return res.status(400).json({
          error: "Invalid patient_id",
        });
      }

      // Duplicate temporary_case_code
      if (
        err.code === "23505" &&
        err.constraint === "emergency_cases_temporary_case_code_key"
      ) {
        return res.status(409).json({
          error: "temporary_case_code already exists",
        });
      }

      console.error("Error creating emergency case:", err.message);

      return res.status(500).json({
        error: "Failed to create emergency case",
      });
    }
  }
);

// GET /api/emergency-cases/:id
// Returns one emergency case by case_id.
// Any authenticated user may view the case.

router.get(
  "/:id",
  authMiddleware,
   requireCaseAccess(),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidCaseId(id)) {
  return res.status(400).json({
    error: "case_id must be a valid integer",
  });
}

      const result = await pool.query(
        `SELECT
           case_id,
           patient_id,
           stay_id,
           temporary_case_code,
           case_status,
           source,
           created_by,
           created_at
         FROM emergency_cases
         WHERE case_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "Emergency case not found",
        });
      }

      return res.status(200).json({
        case: result.rows[0],
      });
    } catch (err) {
      console.error("Error fetching emergency case:", err.message);

      return res.status(500).json({
        error: "Failed to fetch emergency case",
      });
    }
  }
);

// PATCH /api/emergency-cases/:id/status
// Advances an emergency case exactly one step forward in its lifecycle.
// Only specific roles may perform specific transitions - see TRANSITIONS
// below. No backward moves, no skipping steps, no transition out of
// CLOSED (a true terminal state) are ever valid through this endpoint.

const TRANSITIONS = {
  "ARRIVED_ER->ACTIVE_ER": ["ER_STAFF", "ADMIN"],
  "ACTIVE_ER->CLOSED": ["ER_STAFF", "ADMIN"],
};

const VALID_STATUSES = ["PRE_ER", "ARRIVED_ER", "ACTIVE_ER", "CLOSED"];

router.patch(
  "/:id/status",
  authMiddleware,
   requireCaseAccess(), 
  async (req, res) => {
    try {
      const { id } = req.params;
      const { case_status: targetStatus } = req.body;

      if (!isValidCaseId(id)) {
        return res.status(400).json({
          error: "case_id must be a valid integer",
        });
      }

     
if (
  typeof targetStatus !== "string" ||
  !VALID_STATUSES.includes(targetStatus)
) {
  return res.status(400).json({
    error: `case_status must be one of: ${VALID_STATUSES.join(", ")}`,
  });
}
    const existing = await pool.query(
        `SELECT case_id, case_status FROM emergency_cases WHERE case_id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({
          error: "Emergency case not found",
        });
      }

      const currentStatus = existing.rows[0].case_status;
      const transitionKey = `${currentStatus}->${targetStatus}`;
      const allowedRoles = TRANSITIONS[transitionKey];

      if (!allowedRoles) {
        return res.status(409).json({
          error: `Cannot transition from ${currentStatus} to ${targetStatus}`,
        });
      }

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: "You don't have permission to perform this transition",
        });
      }

      const result = await pool.query(
        `UPDATE emergency_cases
         SET case_status = $1
         WHERE case_id = $2
         RETURNING case_id, patient_id, stay_id, temporary_case_code,
                   case_status, source, created_by, created_at`,
        [targetStatus, id]
      );

      return res.status(200).json({
        message: "Emergency case status updated successfully",
        case: result.rows[0],
      });
    } catch (err) {
      console.error("Error updating emergency case status:", err.message);
      return res.status(500).json({
        error: "Failed to update emergency case status",
      });
    }
  }
);

module.exports = router;