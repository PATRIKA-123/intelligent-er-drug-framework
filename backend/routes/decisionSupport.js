const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { generateAndPersistAlerts } = require("../services/alertService");
const { isValidStayId } = require("../validators/idValidator");

// POST /api/decision-support/:stay_id
//
// Explicit, authenticated processing trigger for ONE stay. Unlike
// GET /api/clinical-summary/:stay_id (read-only), this endpoint WRITES:
// it runs the full Phase 2-7 pipeline for the given stay and persists
// the results, using the delete-then-insert idempotency already built
// into Phases 5-7. It does not batch-process anything else.
//
// This route reimplements NONE of the Phase 2-7 logic. It calls
// generateAndPersistAlerts() directly, which already internally calls:
//   getClinicalContext -> getNormalizedMedications -> findDrugInteractions
//   -> persistDrugSafetyResults -> computeAndPersistDecisionSupport
//   -> (alert generation)
// Calling the individual Phase 2-6 functions separately from this route
// would duplicate that entire chain a second time, since
// generateAndPersistAlerts already runs it once per call.
router.post("/:stay_id", authMiddleware, async (req, res) => {
  try {
    const { stay_id } = req.params;

    if (!isValidStayId(stay_id)) {
      return res.status(400).json({
        error: "stay_id must be a valid integer",
      });
    }

    const result = await generateAndPersistAlerts(stay_id);

    if (!result) {
      return res.status(404).json({
        error: "ED stay not found",
      });
    }

    res.json({
      stay_id: result.stay_id,
      decision_support: {
        overall_risk: result.decision.overall_risk,
        decision_priority: result.decision.decision_priority,
        decision_summary: result.decision.decision_summary,
        evidence_source: result.decision.evidence_source,
      },
      alerts: {
        count: result.inserted_count,
        items: result.alerts,
      },
    });
  } catch (err) {
    console.error("Error processing decision support:", err.message);
    res.status(500).json({ error: "Failed to process decision support for this stay" });
  }
});

module.exports = router;