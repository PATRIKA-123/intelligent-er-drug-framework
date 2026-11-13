const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { isValidCaseId, isValidStayId } = require("../validators/idValidator");
const { calculateNEWS2 } = require("../services/news2Calculator");
const { getNormalizedMedications } = require("../services/medicationNormalizationService");
const { getClinicalSummary } = require("../services/clinicalSummaryService");
const { getClinicalContext } = require("../services/clinicalContextService");
const { generateAndPersistAlerts } = require("../services/alertService");

const VALID_TRANSPORT_STATUSES = [
  "DISPATCHED",
  "EN_ROUTE",
  "IN_TRANSIT",
  "ARRIVED_AT_DESTINATION",
  "HANDOVER_COMPLETE",
  "CANCELLED"
];

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "on"].includes(normalized)) return true;
    if (["false", "no", "n", "0", "off"].includes(normalized)) return false;
  }
  if (typeof value === "number") return value === 1;
  return null;
}

function mapConsciousness(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();

  if (["ALERT", "A"].includes(normalized)) {
    return "ALERT";
  }

  if (["NEW_CONFUSION", "V", "P", "U"].includes(normalized)) {
    return normalized;
  }

  return null;
}

function normalizeTransportStatus(status) {
  if (!status) return "DISPATCHED";
  const normalized = String(status).trim().toUpperCase();
  if (VALID_TRANSPORT_STATUSES.includes(normalized)) return normalized;
  return null;
}
const TRANSPORT_STATUS_TRANSITIONS = {
  DISPATCHED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["ARRIVED_AT_DESTINATION", "CANCELLED"],
  ARRIVED_AT_DESTINATION: ["HANDOVER_COMPLETE"],
  HANDOVER_COMPLETE: [],
  CANCELLED: [],
};

function buildNEWS2PreviewFromCase(
  caseId,
  assessment,
  vital,
  options = {}
) {
  const source = vital || assessment || null;

  if (!source) {
    return {
      status: "incomplete",
      missing_fields: [
        "respiratoryRate",
        "spo2",
        "systolicBP",
        "heartRate",
        "temperatureCelsius",
        "consciousness",
        "oxygenSupport"
      ],
      message: "No assessment or vital-sign data is available for NEWS2 evaluation."
    };
  }

  const payload = {
    respiratoryRate: asNumber(
      vital?.respiratory_rate ?? assessment?.respiratory_rate
    ),
    spo2: asNumber(
      vital?.spo2 ?? assessment?.spo2
    ),
    systolicBP: asNumber(
      vital?.systolic_bp ?? assessment?.systolic_bp
    ),
    heartRate: asNumber(
      vital?.heart_rate ?? assessment?.heart_rate
    ),
    temperatureCelsius: asNumber(
      vital?.temperature ?? assessment?.temperature
    ),
    consciousness: mapConsciousness(
      vital?.consciousness_level ?? assessment?.consciousness_status
    ),
    oxygenSupport: parseBoolean(
      vital?.oxygen_support ?? assessment?.oxygen_support
    ),
    spo2Scale: options.spo2Scale ?? 1,
  scale2ClinicianAuthorized:
  options.scale2PermissionVerified === true,
  };

  const missingFields = [];

  for (const [key, value] of Object.entries(payload)) {
    if (key === "scale2ClinicianAuthorized") continue;

    if (value === null || value === undefined || value === "") {
      missingFields.push(key);
    }
  }

  if (missingFields.length > 0) {
    return {
      status: "incomplete",
      case_id: Number(caseId),
      missing_fields: missingFields,
      input: payload,
      message: "NEWS2 calculation is incomplete because required clinical inputs are missing."
    };
  }

  try {
    const result = calculateNEWS2(payload);

    return {
      status: "complete",
      case_id: Number(caseId),
      assessment_time:
        assessment?.assessment_time || vital?.recorded_at || null,
      news2: result,
      input: payload
    };
  } catch (error) {
    return {
      status: "incomplete",
      case_id: Number(caseId),
      input: payload,
      missing_fields: [],
      error: error.message,
      message: "NEWS2 validation failed for the available Pre-ER data."
    };
  }
}

async function getCaseExists(caseId) {
  const result = await pool.query(
    `SELECT case_id, case_status, patient_id, stay_id, temporary_case_code
     FROM emergency_cases WHERE case_id = $1`,
    [caseId]
  );
  return result.rows[0] || null;
}

async function getLatestCaseAssessment(caseId) {
  const result = await pool.query(
    `SELECT * FROM pre_er_assessments WHERE case_id = $1 ORDER BY assessment_time DESC, assessment_id DESC LIMIT 1`,
    [caseId]
  );
  return result.rows[0] || null;
}

async function getLatestCaseVital(caseId) {
  const result = await pool.query(
    `SELECT *
     FROM pre_er_vitals
     WHERE case_id = $1
     ORDER BY recorded_at DESC, vital_id DESC
     LIMIT 1`,
    [caseId]
  );

  return result.rows[0] || null;
}

async function buildCaseWorkflowSnapshot(caseId) {
  const caseInfo = await getCaseExists(caseId);
  if (!caseInfo) {
    return null;
  }

  const latestAssessment = await getLatestCaseAssessment(caseId);
  const latestVital = await getLatestCaseVital(caseId);
  const transportRow = await pool.query(
    `SELECT * FROM ambulance_transports WHERE case_id = $1 ORDER BY created_at DESC, transport_id DESC LIMIT 1`,
    [caseId]
  );

  const clinicalRisk = buildNEWS2PreviewFromCase(caseId, latestAssessment, latestVital);
  const linkedStayId = caseInfo.stay_id ? String(caseInfo.stay_id) : null;
  const rawReportedMedications = latestAssessment?.current_medications;
  const reportedMedications = Array.isArray(rawReportedMedications)
    ? rawReportedMedications
    : [];

  let clinicalSummary = null;
  let normalizedMedications = null;
  let summaryError = null;

  if (linkedStayId) {
    try {
      [clinicalSummary, normalizedMedications] = await Promise.all([
        getClinicalSummary(linkedStayId),
        getNormalizedMedications(linkedStayId),
      ]);
    } catch (error) {
      summaryError = error.message;
    }
  }

  const erMedications = clinicalSummary?.medications || [];
  const safetyFindings = clinicalSummary?.drug_safety?.findings || [];
  const clinicalAlerts = clinicalSummary?.clinical_alerts?.alerts || [];
  const processedByCurrentEngine = Boolean(
    clinicalSummary?.decision_support?.computed_by_current_engine
  );
  const hasErClinicalInputs = Boolean(
    clinicalSummary?.latest_news2 ||
    clinicalSummary?.latest_trend ||
    erMedications.length > 0
  );

  const medicationReconciliation = !latestAssessment
    ? {
        status: "UNAVAILABLE",
        reason: "No Pre-ER assessment is available to determine whether medications were reported.",
        reported_medication_count: 0,
      }
    : reportedMedications.length > 0
      ? {
          status: "PENDING",
          reason: "Reported Pre-ER medications have not been explicitly reconciled. They are not copied into or used by ER medication-safety records.",
          reported_medication_count: reportedMedications.length,
        }
      : {
          status: "NOT_REQUIRED",
          reason: "The latest Pre-ER assessment reports no current medications.",
          reported_medication_count: 0,
        };

  const riskAssessment = {
    status: clinicalRisk.status === "complete" || clinicalSummary?.latest_news2
      ? "COMPLETED"
      : (latestAssessment || latestVital ? "PENDING" : "UNAVAILABLE"),
    pre_er_preview: clinicalRisk,
    er_news2: clinicalSummary?.latest_news2 || null,
  };

  const medicationSafetyStatus = !linkedStayId
    ? "PENDING"
    : summaryError
      ? "FAILED"
      : erMedications.length === 0
        ? "UNAVAILABLE"
        : processedByCurrentEngine
          ? "COMPLETED"
          : "PENDING";

  const medicationSafety = {
    status: medicationSafetyStatus,
    reason: summaryError || (!linkedStayId
      ? "Medication safety requires an ER stay linkage."
      : erMedications.length === 0
        ? "No authoritative ER medication records exist for this stay. Pre-ER reports are not used as ER medication records."
        : processedByCurrentEngine
          ? "The existing ER drug-safety pipeline processed and persisted results for this stay."
          : "ER medication records exist, but the current decision-support pipeline has not processed this stay yet."),
    stay_id: linkedStayId,
    authoritative_medication_count: erMedications.length,
    mapped_medications: normalizedMedications?.mapped_medications || [],
    unmapped_medications: normalizedMedications?.unmapped_medications || [],
    findings: safetyFindings,
    interaction_count: safetyFindings.length,
  };

  const decisionSupportStatus = !linkedStayId
    ? "PENDING"
    : summaryError
      ? "FAILED"
      : processedByCurrentEngine
        ? "COMPLETED"
        : hasErClinicalInputs
          ? "PENDING"
          : "UNAVAILABLE";

  const decisionSupport = {
    status: decisionSupportStatus,
    reason: summaryError || (!linkedStayId
      ? "Decision support requires an ER stay linkage."
      : processedByCurrentEngine
        ? "The existing ER decision-support pipeline has persisted a current-engine result."
        : hasErClinicalInputs
          ? "ER clinical inputs exist, but decision support has not been processed yet."
          : "No ER NEWS2, trend, or medication inputs are available to process."),
    stay_id: linkedStayId,
    result: clinicalSummary?.decision_support?.result || null,
  };

  const alertStatus = !linkedStayId
    ? "PENDING"
    : summaryError
      ? "FAILED"
      : processedByCurrentEngine
        ? "COMPLETED"
        : hasErClinicalInputs
          ? "PENDING"
          : "UNAVAILABLE";

  const alerts = {
    status: alertStatus,
    stay_id: linkedStayId,
    count: clinicalAlerts.length,
    items: clinicalAlerts,
  };

  const transport = transportRow.rows[0] || null;
  const handoverCompleted = transport?.transport_status === "HANDOVER_COMPLETE";
  const workflowProcessingStatus = !linkedStayId
    ? "PENDING"
    : summaryError
      ? "FAILED"
      : processedByCurrentEngine
        ? "COMPLETED"
        : hasErClinicalInputs
          ? "PENDING"
          : "UNAVAILABLE";

  return {
    case_id: Number(caseId),
    case: caseInfo,
    er_linkage: {
      status: linkedStayId ? "COMPLETED" : "PENDING",
      case_id: Number(caseId),
      stay_id: linkedStayId,
      arrival_status: linkedStayId ? "ARRIVED_ER" : "NOT_ARRIVED",
    },
    linked_stay_id: linkedStayId,
    latest_assessment: latestAssessment,
    latest_vital: latestVital,
    transport,
    clinical_risk: clinicalRisk,
    risk_assessment: riskAssessment,
    medication_reconciliation: medicationReconciliation,
    medication_safety: medicationSafety,
    decision_support: decisionSupport,
    alerts,
    clinical_processing: {
      status: workflowProcessingStatus,
      error: summaryError,
    },
    handover_summary: {
      handover_status: handoverCompleted ? "COMPLETED" : (transport ? "PENDING" : "UNAVAILABLE"),
      arrival_status: linkedStayId ? "COMPLETED" : "PENDING",
      linked_stay_id: linkedStayId,
      summary: handoverCompleted
        ? `Case ${caseId} is linked to ER stay ${linkedStayId}, and ambulance handover is marked complete.`
        : linkedStayId
          ? `Case ${caseId} is linked to ER stay ${linkedStayId}; ambulance handover is not yet marked complete.`
          : `Case ${caseId} is still in the Pre-ER phase and is not linked to an ER stay.`,
    },
    integrated_clinical_summary: clinicalSummary,
    workflow_stage: caseInfo.case_status === "CLOSED"
      ? "CLOSED"
      : caseInfo.case_status === "ACTIVE_ER"
        ? "ACTIVE_ER"
        : linkedStayId
          ? "ARRIVED_ER"
          : "PRE_ER_ACTIVE",
  };
}

/**
 * ==========================================
 * 1. INITIAL PATIENT ASSESSMENT & VITALS
 * ==========================================
 */

// POST /api/emergency-cases/:id/assessments
// Records initial physical assessment, vitals, ABC status, and medications
router.post(
  "/:id/assessments",
  authMiddleware,
  authMiddleware.requireRole("PARAMEDIC", "ADMIN"),
  async (req, res) => {
    try {
      const { id: caseId } = req.params;

      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      // Verify case exists
      const caseCheck = await pool.query(
        `SELECT case_id, case_status FROM emergency_cases WHERE case_id = $1`,
        [caseId]
      );

      if (caseCheck.rows.length === 0) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      const {
        assessment_time,
        chief_complaint,
        consciousness_status,
        breathing_status,
        circulation_status,
        pain_score,
        initial_severity,
        notes,
        source,
        symptoms,
        heart_rate,
        respiratory_rate,
        systolic_bp,
        spo2,
        temperature,
        oxygen_support,
        allergy_status,
        current_medications
      } = req.body;

      const recordedBy = req.user.user_id;

      const result = await pool.query(
        `INSERT INTO pre_er_assessments (
          case_id, assessment_time, chief_complaint, consciousness_status, 
          breathing_status, circulation_status, pain_score, initial_severity, 
          notes, source, symptoms, heart_rate, respiratory_rate, systolic_bp, 
          spo2, temperature, oxygen_support, allergy_status, current_medications, recorded_by
        ) VALUES (
          $1, COALESCE($2, CURRENT_TIMESTAMP), $3, $4, $5, $6, $7, $8, 
          $9, COALESCE($10, 'APPLICATION'), $11, $12, $13, $14, 
          $15, $16, $17, COALESCE($18, 'UNKNOWN'),
          COALESCE($19::jsonb, '[]'::jsonb), $20
        )
        RETURNING *`,
        [
          caseId,
          assessment_time || null,
          chief_complaint || null,
          consciousness_status || null,
          breathing_status || null,
          circulation_status || null,
          pain_score ?? null,
          initial_severity || null,
          notes || null,
          source || null,
          symptoms || null,
          heart_rate ?? null,
          respiratory_rate ?? null,
          systolic_bp ?? null,
          spo2 ?? null,
          temperature ?? null,
          oxygen_support ?? null,
          allergy_status || null,
          current_medications ? JSON.stringify(current_medications) : null,
          recordedBy
        ]
      );

      return res.status(201).json({
        message: "Pre-ER assessment recorded successfully",
        assessment: result.rows[0]
      });
    } catch (err) {
      console.error("Error recording Pre-ER assessment:", err.message);
      return res.status(500).json({ error: "Failed to record Pre-ER assessment" });
    }
  }
);

// GET /api/emergency-cases/:id/assessments
// Fetch all assessments recorded for a case
router.get(
  "/:id/assessments",
  authMiddleware,
  async (req, res) => {
    try {
      const { id: caseId } = req.params;

      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const result = await pool.query(
        `SELECT * FROM pre_er_assessments WHERE case_id = $1 ORDER BY assessment_time DESC`,
        [caseId]
      );

      return res.status(200).json({
        case_id: Number(caseId),
        count: result.rowCount,
        assessments: result.rows
      });
    } catch (err) {
      console.error("Error fetching Pre-ER assessments:", err.message);
      return res.status(500).json({ error: "Failed to fetch Pre-ER assessments" });
    }
  }
);


/**
 * ==========================================
 * 2. AMBULANCE & TRANSPORT MANAGEMENT
 * ==========================================
 */

// POST /api/emergency-cases/:id/transport
// Dispatch / log ambulance details for the case
router.post(
  "/:id/transport",
  authMiddleware,
  authMiddleware.requireRole("PARAMEDIC", "ADMIN"),
  async (req, res) => {
    try {
      const { id: caseId } = req.params;

      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      // Verify case exists
      const caseCheck = await pool.query(
        `SELECT case_id FROM emergency_cases WHERE case_id = $1`,
        [caseId]
      );

      if (caseCheck.rows.length === 0) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      const {
        ambulance_id,
        transport_type,
        pickup_location,
        destination_hospital,
        departure_time,
        arrival_time,
        transport_status,
        source,
        notes
      } = req.body;

      if (!ambulance_id) {
        return res.status(400).json({ error: "ambulance_id is required" });
      }
      
      const statusValue = normalizeTransportStatus(transport_status);

     if (!statusValue) {
      return res.status(400).json({
      error: "Invalid transport status",
    allowed_statuses: VALID_TRANSPORT_STATUSES,
    });
  }
      const result = await pool.query(
        `INSERT INTO ambulance_transports (
          case_id, ambulance_id, transport_type, pickup_location,
          destination_hospital, departure_time, arrival_time,
          transport_status, source, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'DISPATCHED'), COALESCE($9, 'APPLICATION'), $10)
        RETURNING *`,
        [
          caseId,
          ambulance_id,
          transport_type || null,
          pickup_location || null,
          destination_hospital || null,
          departure_time || null,
          arrival_time || null,
          statusValue,
          source || null,
          notes || null
        ]
      );

      return res.status(201).json({
        message: "Ambulance transport details recorded successfully",
        transport: result.rows[0]
      });
    } catch (err) {
      console.error("Error saving transport details:", err.message);
      return res.status(500).json({ error: "Failed to save transport details" });
    }
  }
);

// GET /api/emergency-cases/:id/transport
// Get latest or all transport logs for a case
router.get(
  "/:id/transport",
  authMiddleware,
  async (req, res) => {
    try {
      const { id: caseId } = req.params;

      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const result = await pool.query(
        `SELECT * FROM ambulance_transports WHERE case_id = $1 ORDER BY created_at DESC`,
        [caseId]
      );

      return res.status(200).json({
        case_id: Number(caseId),
        count: result.rowCount,
        transports: result.rows
      });
    } catch (err) {
      console.error("Error fetching transport details:", err.message);
      return res.status(500).json({ error: "Failed to fetch transport details" });
    }
  }
);


/**
 * ==========================================
 * 3. PRE-ER HANDOVER SUMMARY (LINKED VIEW)
 * ==========================================
 */

// POST /api/emergency-cases/:id/vitals
// Record a single timestamped Pre-ER vital-sign observation without overwriting history.
router.post(
  "/:id/vitals",
  authMiddleware,
  authMiddleware.requireRole("PARAMEDIC", "ADMIN"),
  async (req, res) => {
    try {
      const { id: caseId } = req.params;
      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const caseInfo = await getCaseExists(caseId);
      if (!caseInfo) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      const {
        recorded_at,
        heart_rate,
        systolic_bp,
        diastolic_bp,
        respiratory_rate,
        spo2,
        temperature,
        oxygen_support,
        consciousness_level,
        source,
        notes
      } = req.body;

      if (
        heart_rate === undefined &&
        systolic_bp === undefined &&
        diastolic_bp === undefined &&
        respiratory_rate === undefined &&
        spo2 === undefined &&
        temperature === undefined
      ) {
        return res.status(400).json({ error: "At least one vital measurement is required" });
      }

      const result = await pool.query(
        `INSERT INTO pre_er_vitals (
          case_id, recorded_at, heart_rate, systolic_bp, diastolic_bp,
          respiratory_rate, spo2, temperature, oxygen_support,
          consciousness_level, source, notes
        ) VALUES (
          $1, COALESCE($2, CURRENT_TIMESTAMP), $3, $4, $5, $6, $7, $8,
          $9, $10, COALESCE($11, 'APPLICATION'), $12
        ) RETURNING *`,
        [
          caseId,
          recorded_at || null,
          asNumber(heart_rate),
          asNumber(systolic_bp),
          asNumber(diastolic_bp),
          asNumber(respiratory_rate),
          asNumber(spo2),
          asNumber(temperature),
          parseBoolean(oxygen_support) ?? null,
          consciousness_level || null,
          source || null,
          notes || null
        ]
      );

      return res.status(201).json({
        message: "Pre-ER vital signs recorded successfully",
        vital: result.rows[0]
      });
    } catch (err) {
      console.error("Error recording Pre-ER vital signs:", err.message);
      return res.status(500).json({ error: "Failed to record Pre-ER vital signs" });
    }
  }
);

// GET /api/emergency-cases/:id/vitals
router.get(
  "/:id/vitals",
  authMiddleware,
  async (req, res) => {
    try {
      const { id: caseId } = req.params;
      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const caseInfo = await getCaseExists(caseId);
      if (!caseInfo) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      const result = await pool.query(
        `SELECT * FROM pre_er_vitals WHERE case_id = $1 ORDER BY recorded_at ASC, vital_id ASC`,
        [caseId]
      );

      return res.status(200).json({
        case_id: Number(caseId),
        count: result.rowCount,
        vitals: result.rows
      });
    } catch (err) {
      console.error("Error fetching Pre-ER vitals:", err.message);
      return res.status(500).json({ error: "Failed to fetch Pre-ER vital signs" });
    }
  }
);

// GET /api/emergency-cases/:id/clinical-risk
// Preview NEWS2 using the existing calculator against the latest assessment/vital history.
router.get(
  "/:id/clinical-risk",
  authMiddleware,
  async (req, res) => {
    try {
      const { id: caseId } = req.params;
      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const caseInfo = await getCaseExists(caseId);
      if (!caseInfo) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      const assessment = await getLatestCaseAssessment(caseId);
      const vital = await getLatestCaseVital(caseId);
      const preview = buildNEWS2PreviewFromCase(caseId, assessment, vital);

      return res.status(200).json({
        case_id: Number(caseId),
        ...preview
      });
    } catch (err) {
      console.error("Error previewing Pre-ER clinical risk:", err.message);
      return res.status(500).json({ error: "Failed to preview Pre-ER clinical risk" });
    }
  }
);

// POST /api/emergency-cases/:id/clinical-risk
router.post(
  "/:id/clinical-risk",
  authMiddleware,
  authMiddleware.requireRole("PARAMEDIC", "ADMIN"),
  async (req, res) => {
    try {
      const { id: caseId } = req.params;
      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const caseInfo = await getCaseExists(caseId);
      if (!caseInfo) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

       const { assessment_id, vital_id, spo2Scale } = req.body || {};

const requestedSpo2Scale = Number(spo2Scale ?? 1);
if (![1, 2].includes(requestedSpo2Scale)) {
  return res.status(400).json({
    error: "spo2Scale must be 1 or 2"
  });
}
let scale2PermissionVerified = false;

// Verify Scale 2 permission from database.
if (requestedSpo2Scale === 2) {
  const permissionResult = await pool.query(
    `SELECT 1
     FROM user_clinical_permissions p
     INNER JOIN users u ON u.user_id = p.user_id
     WHERE p.user_id = $1
       AND p.permission_code = $2
       AND p.revoked_at IS NULL
       AND u.is_active = TRUE
     LIMIT 1`,
    [req.user.user_id, "NEWS2_SPO2_SCALE_2"]
  );

  if (permissionResult.rowCount === 0) {
    return res.status(403).json({
      error: "Active NEWS2 Scale 2 permission is required"
    });
  }

  scale2PermissionVerified = true;
}

const assessment = assessment_id
  ? ((await pool.query(
      `SELECT * FROM pre_er_assessments
       WHERE assessment_id = $1 AND case_id = $2`,
      [assessment_id, caseId]
    )).rows[0] || null)
  : await getLatestCaseAssessment(caseId);

const vital = vital_id
  ? ((await pool.query(
      `SELECT * FROM pre_er_vitals
       WHERE vital_id = $1 AND case_id = $2`,
      [vital_id, caseId]
    )).rows[0] || null)
  : await getLatestCaseVital(caseId);

const computed = buildNEWS2PreviewFromCase(
  caseId,
  assessment,
  vital,
  {
    spo2Scale: requestedSpo2Scale,
    scale2PermissionVerified
  }
);
      return res.status(computed.status === "complete" ? 200 : 422).json({
        case_id: Number(caseId),
        ...computed
      });
    } catch (err) {
      console.error("Error calculating NEWS2 preview:", err.message);
      return res.status(500).json({ error: "Failed to calculate Pre-ER NEWS2 preview" });
    }
  }
);

// GET /api/emergency-cases/:id/news2
// Backwards-compatible alias for the Pre-ER NEWS2 preview route.
router.get(
  "/:id/news2",
  authMiddleware,
  async (req, res) => {
    try {
      const { id: caseId } = req.params;
      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const caseInfo = await getCaseExists(caseId);
      if (!caseInfo) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      const assessment = await getLatestCaseAssessment(caseId);
      const vital = await getLatestCaseVital(caseId);
      console.log("PRE-ER GET HANDLER HIT", {
  file: __filename,
  caseId,
  assessmentFound: !!assessment,
  vitalFound: !!vital,
});
      const preview = buildNEWS2PreviewFromCase(caseId, assessment, vital);

      return res.status(200).json({ case_id: Number(caseId), ...preview });
    } catch (err) {
      console.error("Error fetching Pre-ER NEWS2 preview:", err.message);
      return res.status(500).json({ error: "Failed to fetch Pre-ER NEWS2 preview" });
    }
  }
);

// PATCH /api/emergency-cases/:id/transport
// Update the latest transport record/status while preserving history.
router.patch(
  "/:id/transport",
  authMiddleware,
  authMiddleware.requireRole("PARAMEDIC", "ADMIN"),
  async (req, res) => {
    try {
      const { id: caseId } = req.params;
      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const caseInfo = await getCaseExists(caseId);
      if (!caseInfo) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      const latest = await pool.query(
        `SELECT * FROM ambulance_transports WHERE case_id = $1 ORDER BY created_at DESC, transport_id DESC LIMIT 1`,
        [caseId]
      );

      if (latest.rows.length === 0) {
        return res.status(404).json({ error: "Ambulance transport record not found" });
      }

      const { transport_id } = latest.rows[0];
      const statusValue = normalizeTransportStatus(req.body.transport_status || latest.rows[0].transport_status);
      const currentStatus = latest.rows[0].transport_status;

      if (!statusValue) {
        return res.status(400).json({ error: "transport_status must be one of: DISPATCHED, EN_ROUTE, IN_TRANSIT, ARRIVED_AT_DESTINATION, HANDOVER_COMPLETE, CANCELLED" });
      }

if (
  statusValue !== currentStatus &&
  !TRANSPORT_STATUS_TRANSITIONS[currentStatus]?.includes(statusValue)
) {
  return res.status(409).json({
    error: `Invalid transport status transition: ${currentStatus} -> ${statusValue}`,
    allowed_next_statuses: TRANSPORT_STATUS_TRANSITIONS[currentStatus] || [],
  });
}

      const result = await pool.query(
        `UPDATE ambulance_transports
         SET ambulance_id = COALESCE($2, ambulance_id),
             transport_type = COALESCE($3, transport_type),
             pickup_location = COALESCE($4, pickup_location),
             destination_hospital = COALESCE($5, destination_hospital),
             departure_time = COALESCE($6, departure_time),
             arrival_time = COALESCE($7, arrival_time),
             transport_status = $8,
             source = COALESCE($9, source),
             notes = COALESCE($10, notes)
         WHERE transport_id = $1
         RETURNING *`,
        [
          transport_id,
          req.body.ambulance_id ?? null,
          req.body.transport_type ?? null,
          req.body.pickup_location ?? null,
          req.body.destination_hospital ?? null,
          req.body.departure_time ?? null,
          req.body.arrival_time ?? null,
          statusValue,
          req.body.source ?? latest.rows[0].source ?? "APPLICATION",
          req.body.notes ?? latest.rows[0].notes ?? null
        ]
      );

      return res.status(200).json({
        message: "Ambulance transport status updated successfully",
        transport: result.rows[0]
      });
    } catch (err) {
      console.error("Error updating ambulance transport:", err.message);
      return res.status(500).json({ error: "Failed to update ambulance transport" });
    }
  }
);

// GET /api/emergency-cases/:id/workflow
// Full end-to-end sequence for the integrated Pre-ER to ER flow.
router.get(
  "/:id/workflow",
  authMiddleware,
  async (req, res) => {
    try {
      const { id: caseId } = req.params;

      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const workflow = await buildCaseWorkflowSnapshot(caseId);

      if (!workflow) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      return res.status(200).json(workflow);
    } catch (err) {
      console.error("Error building workflow snapshot:", err.message);
      return res.status(500).json({ error: "Failed to build the integrated Pre-ER workflow" });
    }
  }
);

router.get(
  "/:id/integrated-summary",
  authMiddleware,
  async (req, res) => {
    try {
      const { id: caseId } = req.params;

      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const workflow = await buildCaseWorkflowSnapshot(caseId);

      if (!workflow) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      return res.status(200).json({
        case_id: workflow.case_id,
        case: workflow.case,
        workflow_stage: workflow.workflow_stage,
        er_linkage: workflow.er_linkage,
        integrated_summary: workflow.integrated_clinical_summary,
        handover_summary: workflow.handover_summary,
        clinical_risk: workflow.clinical_risk,
        risk_assessment: workflow.risk_assessment,
        medication_reconciliation: workflow.medication_reconciliation,
        medication_safety: workflow.medication_safety,
        alerts: workflow.alerts,
        decision_support: workflow.decision_support,
        clinical_processing: workflow.clinical_processing,
      });
    } catch (err) {
      console.error("Error building integrated summary:", err.message);
      return res.status(500).json({ error: "Failed to build the integrated clinical summary" });
    }
  }
);

// GET /api/emergency-cases/:id/handover-summary
// Aggregates Case Info + Transport + Vitals/Assessments for ER doctors
router.get(
  "/:id/handover-summary",
  authMiddleware,
  async (req, res) => {
    try {
      const { id: caseId } = req.params;

      if (!isValidCaseId(caseId)) {
        return res.status(400).json({ error: "case_id must be a valid integer" });
      }

      const workflow = await buildCaseWorkflowSnapshot(caseId);

      if (!workflow) {
        return res.status(404).json({ error: "Emergency case not found" });
      }

      return res.status(200).json({
        case: workflow.case,
        linked_stay_id: workflow.linked_stay_id,
        latest_transport: workflow.transport,
        latest_assessment: workflow.latest_assessment,
        latest_vital: workflow.latest_vital,
        clinical_risk: workflow.clinical_risk,
        risk_assessment: workflow.risk_assessment,
        medication_reconciliation: workflow.medication_reconciliation,
        medication_safety: workflow.medication_safety,
        decision_support: workflow.decision_support,
        alerts: workflow.alerts,
        clinical_processing: workflow.clinical_processing,
        handover_status: workflow.handover_summary.handover_status,
        arrival_status: workflow.handover_summary.arrival_status,
        completed_handover: workflow.handover_summary.handover_status === "COMPLETED",
        integrated_summary: workflow.integrated_clinical_summary,
      });
    } catch (err) {
      console.error("Error building handover summary:", err.message);
      return res.status(500).json({ error: "Failed to generate handover summary" });
    }
  }
);

// POST /api/emergency-cases/:id/er-arrival
// Establish a real ER stay linkage only when the target stay_id exists.
router.post(
  "/:id/er-arrival",
  authMiddleware,
  authMiddleware.requireRole("PARAMEDIC", "ADMIN", "ER_STAFF"),
  async (req, res) => {
    const { id: caseId } = req.params;
    const { stay_id: stayId } = req.body;

    if (!isValidCaseId(caseId)) {
      return res.status(400).json({ error: "case_id must be a valid integer" });
    }

    if (!isValidStayId(stayId)) {
      return res.status(400).json({ error: "stay_id must be a valid integer" });
    }

    let client;
    let transactionStarted = false;
    let linkedCase;

    try {
      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const caseResult = await client.query(
        `SELECT case_id, patient_id, stay_id, temporary_case_code, case_status, source, created_by, created_at
         FROM emergency_cases
         WHERE case_id = $1
         FOR UPDATE`,
        [caseId]
      );

      if (caseResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ error: "Emergency case not found" });
      }

      const existingCase = caseResult.rows[0];
      if (existingCase.stay_id && String(existingCase.stay_id) !== String(stayId)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({ error: "Emergency case is already linked to a different ER stay" });
      }

      const stayLinkResult = await client.query(
        `SELECT case_id
         FROM emergency_cases
         WHERE stay_id = $1 AND case_id <> $2
         FOR UPDATE`,
        [stayId, caseId]
      );
      if (stayLinkResult.rows.length > 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({ error: "ER stay is already linked to another emergency case" });
      }

      if (!existingCase.stay_id && existingCase.case_status !== "PRE_ER") {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({ error: `Cannot link an ER stay while case status is ${existingCase.case_status}` });
      }

      const stayResult = await client.query(
        `SELECT e.stay_id, p.patient_id
         FROM ed_stays e
         JOIN patients p ON p.subject_id = e.subject_id
         WHERE e.stay_id = $1
         FOR SHARE OF e`,
        [stayId]
      );

      if (stayResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ error: "ED stay or linked patient not found" });
      }

      const erPatientId = stayResult.rows[0].patient_id;
      if (
        existingCase.patient_id !== null &&
        String(existingCase.patient_id) !== String(erPatientId)
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({ error: "Emergency case patient does not match the ER stay patient" });
      }

      
const updated = await client.query(
  `UPDATE emergency_cases
   SET patient_id = $1,
       stay_id = $2,
       case_status = CASE
         WHEN case_status = 'PRE_ER' THEN 'ARRIVED_ER'
         ELSE case_status
       END
   WHERE case_id = $3
   RETURNING case_id, patient_id, stay_id, temporary_case_code, case_status, source, created_by, created_at`,
  [erPatientId, stayId, caseId]
);

linkedCase = updated.rows[0];
 

const transportResult = await client.query(
  `UPDATE ambulance_transports
   SET transport_status = 'ARRIVED_AT_DESTINATION',
       arrival_time = COALESCE(arrival_time, CURRENT_TIMESTAMP)
   WHERE transport_id = (
     SELECT transport_id
     FROM ambulance_transports
     WHERE case_id = $1
       AND transport_status != 'CANCELLED'
     ORDER BY created_at DESC, transport_id DESC
     LIMIT 1
   )
   RETURNING transport_id, case_id, transport_status, arrival_time`,
  [caseId]
);

      await client.query("COMMIT");
      transactionStarted = false;
    } catch (err) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("ER-arrival rollback failed:", rollbackError.message);
        }
      }

      console.error("Error linking ER arrival:", err.message);
      return res.status(500).json({ error: "Failed to link ER arrival" });
    } finally {
      if (client) client.release();
    }

    try {
      const context = await getClinicalContext(stayId);
      const hasClinicalInputs = Boolean(
        context && (
          context.latest_news2 ||
          context.latest_trend ||
          context.medications.length > 0
        )
      );

      if (!context) {
        return res.status(500).json({
          message: "ER stay linked, but clinical processing could not load the linked stay.",
          case_linked: true,
          case: linkedCase,
          processing: {
            status: "FAILED",
            error: "Linked ER stay is no longer available to the clinical context service.",
          },
        });
      }

      if (!hasClinicalInputs) {
        return res.status(200).json({
          message: "ER arrival linked; clinical processing is unavailable because the stay has no NEWS2, trend, or ER medication inputs.",
          case_linked: true,
          case: linkedCase,
          processing: {
            status: "UNAVAILABLE",
            reason: "No ER NEWS2, trend, or medication inputs are available.",
          },
        });
      }

      const processing = await generateAndPersistAlerts(stayId);
      if (!processing) {
        return res.status(500).json({
          message: "ER stay linked, but the ER processing service returned no result.",
          case_linked: true,
          case: linkedCase,
          processing: {
            status: "FAILED",
            error: "ER decision-support and alert processing returned no result.",
          },
        });
      }

      return res.status(200).json({
        message: "ER arrival linked and ER clinical processing completed.",
        case_linked: true,
        case: linkedCase,
        processing: {
          status: "COMPLETED",
          stay_id: String(processing.stay_id),
          decision_support: processing.decision,
          drug_safety: processing.drug_safety,
          alerts: {
            deleted_count: processing.deleted_count,
            inserted_count: processing.inserted_count,
            items: processing.alerts,
          },
        },
      });
    } catch (err) {
      console.error("ER clinical processing failed after linkage:", err.message);
      return res.status(500).json({
        message: "ER stay linked, but ER clinical processing failed.",
        case_linked: true,
        case: linkedCase,
        processing: {
          status: "FAILED",
          error: err.message,
        },
      });
    }
  }
);

module.exports = router;