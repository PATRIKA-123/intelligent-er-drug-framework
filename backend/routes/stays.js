const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { isValidStayId } = require("../validators/idValidator");
const { parseStayQuery } = require("../validators/stayQuery");
const { assumedInputsSql } = require("../services/inputProvenance");
const { requireStayAccess, stayListFilter } = require("../services/accessPolicy");

async function stayExists(stay_id) {
  const result = await pool.query(`SELECT 1 FROM ed_stays WHERE stay_id = $1`, [stay_id]);
  return result.rows.length > 0;
}

// B19/B20: stable, bounded, scoped paging. Existing limit/offset/count/stays
// fields are kept for frontend compatibility; total/has_more are additive.
router.get("/", authMiddleware, async (req, res) => {
  const page = parseStayQuery(req.query);
  if (page.error) return res.status(400).json({ error: page.error, code: page.code });
  try {
    const { clause, params } = await stayListFilter(req.user);
    const filters = [clause];
    const filtersParams = [...params];
    if (page.search !== null) {
      // Bound parameter; escape SQL LIKE special characters so user text is literal.
      filtersParams.push(`%${page.search.replace(/[\\%_]/g, "\\$&")}%`);
      filters.push(`(s.chiefcomplaint ILIKE $${filtersParams.length} ESCAPE '\\' OR s.stay_id::text = $${filtersParams.length + 1})`);
      filtersParams.push(page.search);
    }
    const where = filters.map((f) => `(${f})`).join(" AND ");
    // Both SELECTs run under the caller's access policy (no global count leak).
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ed_stays s WHERE ${where}`,
      filtersParams
    );
    const listParams = [...filtersParams, page.limit, page.offset];
    const result = await pool.query(
      `SELECT s.stay_id, s.subject_id, s.intime, s.outtime, s.gender,
              s.disposition, s.chiefcomplaint, s.acuity
       FROM ed_stays s WHERE ${where}
       ORDER BY s.intime ASC NULLS LAST, s.stay_id ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    const total = Number(countResult.rows[0].total);
    return res.json({
      limit: page.limit,
      offset: page.offset,
      count: result.rows.length,
      total,
      has_more: page.offset + result.rows.length < total,
      stays: result.rows,
    });
  } catch (err) {
    console.error("Error fetching stays:", err.message);
    return res.status(500).json({ error: "Failed to fetch stays", code: "INTERNAL_ERROR" });
  }
});

router.get("/:stay_id", authMiddleware, requireStayAccess(), async (req, res) => {
  try {
    const { stay_id } = req.params;
    const result = await pool.query(
      `SELECT stay_id, subject_id, intime, outtime, gender, disposition,
              chiefcomplaint, acuity FROM ed_stays WHERE stay_id = $1`, [stay_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "ED stay not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching stay:", err.message);
    return res.status(500).json({ error: "Failed to fetch ED stay" });
  }
});

router.get("/:stay_id/observations", authMiddleware, requireStayAccess(), async (req, res) => {
  try {
    const { stay_id } = req.params;
    if (!isValidStayId(stay_id)) return res.status(400).json({ error: "stay_id must be a valid integer" });
    if (!(await stayExists(stay_id))) return res.status(404).json({ error: "ED stay not found" });
    const prov = await assumedInputsSql("o");
    const result = await pool.query(
      `SELECT c.observation_id, c.observation_time, c.temperature, c.temperature_celsius,
              c.heart_rate, c.respiratory_rate, c.spo2, c.systolic_bp,
              c.consciousness, c.oxygen_support, c.spo2_scale,
              ${prov.columns}
       FROM observations_clean c JOIN observations o ON o.observation_id = c.observation_id
       WHERE c.stay_id = $1 ORDER BY c.observation_time`, [stay_id]
    );
    return res.json({ stay_id, count: result.rowCount, observations: result.rows });
  } catch (err) {
    console.error("Error fetching observations:", err.message);
    return res.status(500).json({ error: "Failed to fetch observations" });
  }
});

router.get("/:stay_id/news2", authMiddleware, requireStayAccess(), async (req, res) => {
  try {
    const { stay_id } = req.params;
    if (!isValidStayId(stay_id)) return res.status(400).json({ error: "stay_id must be a valid integer" });
    if (!(await stayExists(stay_id))) return res.status(404).json({ error: "ED stay not found" });
    const prov = await assumedInputsSql("o");
    // B10_DURABLE_NEWS2_PROVENANCE: use stored snapshot where migrated.
    const { hasColumn } = require("../services/schemaCapabilities");
    const hasSnapshot = await hasColumn("news2_input_provenance", "observation_id");
    const individualFlags = hasSnapshot
      ? "s.consciousness_assumed, s.oxygen_support_assumed, s.spo2_scale_assumed,"
      : prov.columns + ",";
    const basedOn = hasSnapshot
      ? "CASE WHEN s.consciousness_assumed IS TRUE OR s.oxygen_support_assumed IS TRUE OR s.spo2_scale_assumed IS TRUE THEN TRUE WHEN s.consciousness_assumed IS FALSE AND s.oxygen_support_assumed IS FALSE AND s.spo2_scale_assumed IS FALSE THEN FALSE ELSE NULL END"
      : prov.basedOn;
    const missing = hasSnapshot
      ? "CASE WHEN s.observation_id IS NULL THEN NULL ELSE (s.consciousness_missing OR s.oxygen_support_missing OR s.spo2_scale_missing) END"
      : "CASE WHEN o.observation_id IS NULL THEN NULL ELSE (o.consciousness IS NULL OR o.oxygen_support IS NULL OR o.spo2_scale IS NULL) END";
    const origin = hasSnapshot ? "s.provenance_origin" : "'LIVE_DERIVED'::text";
    const snapJoin = hasSnapshot ? "LEFT JOIN news2_input_provenance s ON s.observation_id = n.observation_id" : "";

    const result = await pool.query(
      `SELECT n.observation_id, n.observation_time, n.total_news2_score, n.risk_level,
              n.respiratory_score, n.spo2_score, n.oxygen_score, n.systolic_bp_score,
              n.heart_rate_score, n.temperature_score, n.consciousness_score,
              ${individualFlags}
              ${basedOn} AS based_on_assumed_inputs,
              ${missing} AS based_on_missing_inputs,
              ${origin} AS input_provenance_origin
       FROM news2_results_real n LEFT JOIN observations o ON o.observation_id = n.observation_id
       ${snapJoin}
       WHERE n.stay_id = $1 ORDER BY n.observation_time`, [stay_id]
    );
    return res.json({ stay_id, count: result.rowCount, news2_results: result.rows });
  } catch (err) {
    console.error("Error fetching NEWS2 results:", err.message);
    return res.status(500).json({ error: "Failed to fetch NEWS2 results" });
  }
});

router.get("/:stay_id/trends", authMiddleware, requireStayAccess(), async (req, res) => {
  try {
    const { stay_id } = req.params;
    if (!isValidStayId(stay_id)) return res.status(400).json({ error: "stay_id must be a valid integer" });
    if (!(await stayExists(stay_id))) return res.status(404).json({ error: "ED stay not found" });
    const result = await pool.query(
      `SELECT observation_time, minutes_since_prev,
              delta_spo2, delta_heart_rate, delta_systolic_bp, delta_respiratory_rate,
              spo2_rate_per_hour, hr_rate_per_hour, sbp_rate_per_hour, rr_rate_per_hour,
              trend_classification FROM trend_results
       WHERE stay_id = $1 ORDER BY observation_time`, [stay_id]
    );
    return res.json({ stay_id, count: result.rowCount, trends: result.rows });
  } catch (err) {
    console.error("Error fetching trend results:", err.message);
    return res.status(500).json({ error: "Failed to fetch trend results" });
  }
});

router.get("/:stay_id/diagnoses", authMiddleware, requireStayAccess(), async (req, res) => {
  try {
    const { stay_id } = req.params;
    if (!isValidStayId(stay_id)) return res.status(400).json({ error: "stay_id must be a valid integer" });
    if (!(await stayExists(stay_id))) return res.status(404).json({ error: "ED stay not found" });
    const result = await pool.query(
      `SELECT diagnosis_id, seq_num, icd_code, icd_version, icd_title
       FROM diagnoses WHERE stay_id = $1 ORDER BY seq_num`, [stay_id]
    );
    return res.json({ stay_id, count: result.rowCount, diagnoses: result.rows });
  } catch (err) {
    console.error("Error fetching diagnoses:", err.message);
    return res.status(500).json({ error: "Failed to fetch diagnoses" });
  }
});

module.exports = router;
