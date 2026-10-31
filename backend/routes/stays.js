const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { isValidStayId } = require("../validators/idValidator");

// Returns true if an ED stay with this stay_id exists. Used by the
// sub-routes below so a nonexistent stay returns 404 instead of an
// empty 200 that looks the same as an existing stay with no records.
async function stayExists(stay_id) {
  const result = await pool.query(
    `SELECT 1 FROM ed_stays WHERE stay_id = $1`,
    [stay_id]
  );
  return result.rows.length > 0;
}

// Get first 20 ED stays
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT stay_id, subject_id, intime, outtime, gender, disposition,
              chiefcomplaint, acuity
       FROM ed_stays
       ORDER BY intime
       LIMIT 20`
    );

    res.json({
      count: result.rowCount,
      stays: result.rows
    });
  } catch (err) {
    console.error("Error fetching stays:", err.message);
    res.status(500).json({ error: "Failed to fetch stays" });
  }
});

// Get one specific ED stay
router.get("/:stay_id", authMiddleware, async (req, res) => {
  try {
    const { stay_id } = req.params;

    if (!isValidStayId(stay_id)) {
      return res.status(400).json({
        error: "stay_id must be a valid integer"
      });
    }

    const result = await pool.query(
      `SELECT stay_id, subject_id, intime, outtime, gender, disposition,
              chiefcomplaint, acuity
       FROM ed_stays
       WHERE stay_id = $1`,
      [stay_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "ED stay not found"
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching stay:", err.message);
    res.status(500).json({ error: "Failed to fetch ED stay" });
  }
});

// Get vital-sign observations for one specific ED stay
router.get("/:stay_id/observations", authMiddleware, async (req, res) => {
  try {
    const { stay_id } = req.params;

    if (!isValidStayId(stay_id)) {
      return res.status(400).json({
        error: "stay_id must be a valid integer"
      });
    }

    if (!(await stayExists(stay_id))) {
      return res.status(404).json({
        error: "ED stay not found"
      });
    }

    const result = await pool.query(
      `SELECT observation_id, observation_time, temperature, temperature_celsius,
              heart_rate, respiratory_rate, spo2, systolic_bp,
              consciousness, oxygen_support, spo2_scale
       FROM observations_clean
       WHERE stay_id = $1
       ORDER BY observation_time`,
      [stay_id]
    );

    res.json({
      stay_id,
      count: result.rowCount,
      observations: result.rows
    });
  } catch (err) {
    console.error("Error fetching observations:", err.message);
    res.status(500).json({ error: "Failed to fetch observations" });
  }
});

// Get NEWS2 scores for a specific ED stay
router.get("/:stay_id/news2", authMiddleware, async (req, res) => {
  try {
    const { stay_id } = req.params;

    if (!isValidStayId(stay_id)) {
      return res.status(400).json({
        error: "stay_id must be a valid integer"
      });
    }

    if (!(await stayExists(stay_id))) {
      return res.status(404).json({
        error: "ED stay not found"
      });
    }

    const result = await pool.query(
      `SELECT observation_id, observation_time, total_news2_score, risk_level,
              respiratory_score, spo2_score, oxygen_score, systolic_bp_score,
              heart_rate_score, temperature_score, consciousness_score
       FROM news2_results_real
       WHERE stay_id = $1
       ORDER BY observation_time`,
      [stay_id]
    );



    res.json({
      stay_id,
      count: result.rowCount,
      news2_results: result.rows
    });
  } catch (err) {
    console.error("Error fetching NEWS2 results:", err.message);
    res.status(500).json({ error: "Failed to fetch NEWS2 results" });
  }
});

// Get temporal trend results for a specific ED stay
router.get("/:stay_id/trends", authMiddleware, async (req, res) => {
  try {
    const { stay_id } = req.params;

    if (!isValidStayId(stay_id)) {
      return res.status(400).json({
        error: "stay_id must be a valid integer"
      });
    }

    if (!(await stayExists(stay_id))) {
      return res.status(404).json({
        error: "ED stay not found"
      });
    }

    const result = await pool.query(
      `SELECT observation_time, minutes_since_prev,
              delta_spo2, delta_heart_rate, delta_systolic_bp, delta_respiratory_rate,
              spo2_rate_per_hour, hr_rate_per_hour, sbp_rate_per_hour, rr_rate_per_hour,
              trend_classification
       FROM trend_results
       WHERE stay_id = $1
       ORDER BY observation_time`,
      [stay_id]
    );

    res.json({
      stay_id,
      count: result.rowCount,
      trends: result.rows
    });
  } catch (err) {
    console.error("Error fetching trend results:", err.message);
    res.status(500).json({ error: "Failed to fetch trend results" });
  }
});

// Get diagnoses for a specific ED stay
router.get("/:stay_id/diagnoses", authMiddleware, async (req, res) => {
  try {
    const { stay_id } = req.params;

    if (!isValidStayId(stay_id)) {
      return res.status(400).json({
        error: "stay_id must be a valid integer"
      });
    }

    if (!(await stayExists(stay_id))) {
      return res.status(404).json({
        error: "ED stay not found"
      });
    }

    const result = await pool.query(
      `SELECT diagnosis_id, seq_num, icd_code, icd_version, icd_title
       FROM diagnoses
       WHERE stay_id = $1
       ORDER BY seq_num`,
      [stay_id]
    );

    res.json({
      stay_id,
      count: result.rowCount,
      diagnoses: result.rows
    });
  } catch (err) {
    console.error("Error fetching diagnoses:", err.message);
    res.status(500).json({ error: "Failed to fetch diagnoses" });
  }
});

module.exports = router;