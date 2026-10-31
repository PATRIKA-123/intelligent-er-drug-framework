const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { getClinicalSummary } = require("../services/clinicalSummaryService");
const { isValidStayId } = require("../validators/idValidator");

// GET /api/clinical-summary/:stay_id
// READ-ONLY. Aggregates already-persisted data for one ED stay:
// stay, patient, diagnoses, medications, latest observation, latest
// NEWS2, latest trend, allergies/history, decision support, drug
// safety findings, and clinical alerts. Does not run or trigger any
// of the Phase 2-7 calculation/persistence logic.
router.get("/:stay_id", authMiddleware, async (req, res) => {
  try {
    const { stay_id } = req.params;

    if (!isValidStayId(stay_id)) {
      return res.status(400).json({
        error: "stay_id must be a valid integer",
      });
    }

    const summary = await getClinicalSummary(stay_id);

    if (!summary) {
      return res.status(404).json({
        error: "ED stay not found",
      });
    }

    res.json(summary);
  } catch (err) {
    console.error("Error fetching clinical summary:", err.message);
    res.status(500).json({ error: "Failed to fetch clinical summary" });
  }
});

module.exports = router;