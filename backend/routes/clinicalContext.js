const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { getClinicalContext } = require("../services/clinicalContextService");
const { isValidStayId } = require("../validators/idValidator");
const { requireStayAccess } = require("../services/accessPolicy");

// GET /api/clinical-context/:stay_id
// Returns the aggregated clinical context for one ED stay:
// stay, patient, diagnoses, medications, latest observation,
// latest NEWS2 result, latest trend result.
// Requires authentication, same as the other clinical stay routes.
router.get("/:stay_id", authMiddleware, requireStayAccess(), async (req, res) => {
  try {
    const { stay_id } = req.params;

    if (!isValidStayId(stay_id)) {
      return res.status(400).json({
        error: "stay_id must be a valid integer",
      });
    }

    const context = await getClinicalContext(stay_id);

    if (!context) {
      return res.status(404).json({
        error: "ED stay not found",
      });
    }

    res.json(context);
  } catch (err) {
    console.error("Error fetching clinical context:", err.message);
    res.status(500).json({ error: "Failed to fetch clinical context" });
  }
});

module.exports = router;