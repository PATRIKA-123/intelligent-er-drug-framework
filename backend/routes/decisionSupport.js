"use strict";
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { generateAndPersistAlerts } = require("../services/alertService");
const { isValidStayId } = require("../validators/idValidator");
const { requireStayAccess } = require("../services/accessPolicy");

// B02: only assigned doctors, authorized ER staff and administrators may
// trigger processing; stay-access policy is enforced before this handler.
const DECISION_SUPPORT_ROLES = ["ADMIN", "ER_STAFF", "DOCTOR"];
function audit(event, fields) {
  console.log(JSON.stringify({ event, ...fields }));
}

router.post(
  "/:stay_id",
  authMiddleware,
  authMiddleware.requireRole(...DECISION_SUPPORT_ROLES),
  requireStayAccess(),
  async (req, res) => {
    const { stay_id } = req.params;
    const who = { user_id: req.user.user_id, role: req.user.role, stay_id };
    const startedAt = Date.now();
    const finish = outcome => audit("decision_support_finished", {
      ...who, outcome, duration_ms: Date.now() - startedAt,
    });
    try {
      if (!isValidStayId(stay_id)) {
        return res.status(400).json({ error: "stay_id must be a valid integer" });
      }
      audit("decision_support_started", who);
      const result = await generateAndPersistAlerts(stay_id);
      if (!result) {
        finish("NOT_FOUND");
        return res.status(404).json({ error: "ED stay not found" });
      }
      finish("COMPLETED");
      return res.json({
        stay_id: result.stay_id,
        decision_support: {
          overall_risk: result.decision.overall_risk,
          decision_priority: result.decision.decision_priority,
          decision_summary: result.decision.decision_summary,
          evidence_source: result.decision.evidence_source,
        },
        alerts: { count: result.inserted_count, items: result.alerts },
      });
    } catch (err) {
      if (err.statusCode === 409) {
        finish("CONFLICT");
        return res.status(409).json({ error: err.message });
      }
      // B14: do not suggest that zero findings were confirmed when a
      // medication mapping is missing or contradictory. Nothing is persisted.
      if (err.code === "AMBIGUOUS_MEDICATION_MAPPING" || err.code === "INCOMPLETE_MEDICATION_MAPPING") {
        finish("INCOMPLETE_MAPPING");
        return res.status(422).json({
          error: "Drug safety screening incomplete: medication mappings require review",
          screening_status: "INCOMPLETE",
          reason_code: err.code,
        });
      }
      finish("FAILED");
      console.error("Error processing decision support:", err.message);
      return res.status(500).json({ error: "Failed to process decision support for this stay" });
    }
  }
);
module.exports = router;
