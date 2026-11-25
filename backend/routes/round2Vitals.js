"use strict";

const express = require("express");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { requireStayAccess } = require("../services/accessPolicy");
const { calculateNEWS2 } = require("../services/news2Calculator");
const { calculateVitalTrend } = require("../services/trendCalculator");

const router = express.Router();
const CAN_RECORD = authMiddleware.requireRole("ER_STAFF", "DOCTOR", "ADMIN");
const RANGES = {
  heart_rate: [20, 300],
  respiratory_rate: [3, 80],
  systolic_bp: [40, 300],
  diastolic_bp: [20, 200],
  spo2: [50, 100],
  temperature_celsius: [30, 45],
};
const AVPU = new Set(["ALERT", "NEW_CONFUSION", "V", "P", "U"]);
const REQUIRED = [
  "heart_rate",
  "respiratory_rate",
  "systolic_bp",
  "spo2",
  "temperature_celsius",
  "consciousness",
  "oxygen_support",
  "spo2_scale",
];

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function validate(body) {
  if (!body || typeof body !== "object") return { error: "Request body is required." };
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const n = num(body[k]);
    if (Number.isNaN(n)) return { error: `${k} must be a number.` };
    if (n !== null && (n < lo || n > hi)) return { error: `${k} must be between ${lo} and ${hi}.` };
    out[k] = n;
  }
  if (out.diastolic_bp !== null && out.systolic_bp !== null && out.diastolic_bp >= out.systolic_bp) {
    return { error: "diastolic_bp must be less than systolic_bp." };
  }
  if (body.consciousness != null && body.consciousness !== "") {
    const c = String(body.consciousness).trim().toUpperCase();
    if (!AVPU.has(c)) return { error: "consciousness must be ALERT, NEW_CONFUSION, V, P, or U." };
    out.consciousness = c;
  } else out.consciousness = null;

  if (body.oxygen_support === null || body.oxygen_support === undefined || body.oxygen_support === "") out.oxygen_support = null;
  else if (typeof body.oxygen_support === "boolean") out.oxygen_support = body.oxygen_support;
  else if (body.oxygen_support === "true" || body.oxygen_support === "false") out.oxygen_support = body.oxygen_support === "true";
  else return { error: "oxygen_support must be true or false." };

  if (body.spo2_scale === null || body.spo2_scale === undefined || body.spo2_scale === "") out.spo2_scale = null;
  else if (body.spo2_scale === 1 || body.spo2_scale === 2 || body.spo2_scale === "1" || body.spo2_scale === "2") out.spo2_scale = Number(body.spo2_scale);
  else return { error: "spo2_scale must be 1 or 2." };

  if (body.observation_time != null && body.observation_time !== "") {
    const t = new Date(body.observation_time);
    if (!Number.isFinite(t.getTime())) return { error: "observation_time is invalid." };
    out.observation_time = t.toISOString();
  } else out.observation_time = null;

  const missing = REQUIRED.filter((k) => out[k] === null);
  const anyNumeric = Object.keys(RANGES).some((k) => out[k] !== null);
  if (!anyNumeric) return { error: "Enter at least one measurement." };
  out.complete = missing.length === 0;
  out.missing = missing;
  return out;
}

function news2Of(v, scale2Ok) {
  if (!v.complete) return { complete: false, missing: v.missing };
  try {
    return {
      complete: true,
      ...calculateNEWS2({
        respiratoryRate: v.respiratory_rate,
        spo2: v.spo2,
        systolicBP: v.systolic_bp,
        heartRate: v.heart_rate,
        temperatureCelsius: v.temperature_celsius,
        consciousness: v.consciousness,
        oxygenSupport: v.oxygen_support,
        spo2Scale: v.spo2_scale,
        scale2ClinicianAuthorized: scale2Ok,
      }),
    };
  } catch (e) {
    return { complete: false, error: e.message };
  }
}

router.post("/:stay_id/observations", authMiddleware, CAN_RECORD, requireStayAccess(), async (req, res) => {
  const stayId = Number(req.params.stay_id);
  if (!Number.isSafeInteger(stayId) || stayId <= 0) return res.status(400).json({ error: "stay_id must be a valid integer" });
  const v = validate(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stay = await client.query("SELECT stay_id, subject_id, outtime FROM ed_stays WHERE stay_id=$1 FOR UPDATE", [stayId]);
    if (!stay.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ED stay not found" });
    }
    if (stay.rows[0].outtime) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Cannot record vitals after the patient has departed." });
    }

    let scale2Ok = false;
    if (v.spo2_scale === 2) {
      const p = await client.query(
        "SELECT 1 FROM user_clinical_permissions WHERE user_id=$1 AND permission_code='NEWS2_SPO2_SCALE_2' AND revoked_at IS NULL",
        [req.user.user_id]
      );
      if (!p.rows.length) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Active NEWS2 Scale 2 permission is required." });
      }
      scale2Ok = true;
    }

    const prevObsRes = await client.query(
      `SELECT observation_time, spo2, heart_rate, systolic_bp, respiratory_rate
       FROM observations_clean
       WHERE stay_id = $1
         AND spo2 IS NOT NULL AND heart_rate IS NOT NULL
         AND systolic_bp IS NOT NULL AND respiratory_rate IS NOT NULL
       ORDER BY observation_time DESC, observation_id DESC
       LIMIT 1`,
      [stayId]
    );
    const prevNews2Res = await client.query(
      `SELECT total_news2_score
       FROM news2_results_real
       WHERE stay_id = $1
       ORDER BY observation_time DESC, observation_id DESC
       LIMIT 1`,
      [stayId]
    );

    const ins = await client.query(
      `INSERT INTO public.er_vital_entries
        (stay_id,observation_time,heart_rate,respiratory_rate,systolic_bp,diastolic_bp,spo2,temperature_celsius,consciousness,oxygen_support,spo2_scale,recorded_by)
       VALUES ($1,COALESCE($2::timestamptz,NOW()),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        stayId,
        v.observation_time,
        v.heart_rate,
        v.respiratory_rate,
        v.systolic_bp,
        v.diastolic_bp,
        v.spo2,
        v.temperature_celsius,
        v.consciousness,
        v.oxygen_support,
        v.spo2_scale,
        req.user.user_id,
      ]
    );

    const savedEntry = ins.rows[0];
    const news2 = news2Of(v, scale2Ok);
    let trend = null;

    if (v.complete && news2.complete) {
      const cleanIns = await client.query(
        `INSERT INTO observations_clean
          (stay_id, subject_id, observation_time, temperature, temperature_celsius,
           heart_rate, respiratory_rate, spo2, systolic_bp, diastolic_bp,
           consciousness, oxygen_support, spo2_scale)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING observation_id, observation_time`,
        [
          stayId,
          stay.rows[0].subject_id,
          savedEntry.observation_time,
          v.temperature_celsius,
          v.heart_rate,
          v.respiratory_rate,
          v.spo2,
          v.systolic_bp,
          v.diastolic_bp,
          v.consciousness,
          v.oxygen_support,
          v.spo2_scale,
        ]
      );

      const newObsId = cleanIns.rows[0]?.observation_id;

      if (newObsId) {
        await client.query(
          `INSERT INTO news2_results_real
            (observation_id, stay_id, subject_id, observation_time,
             respiratory_score, spo2_score, oxygen_score, systolic_bp_score,
             heart_rate_score, temperature_score, consciousness_score,
             total_news2_score, risk_level)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (observation_id) DO UPDATE SET
             total_news2_score = EXCLUDED.total_news2_score,
             risk_level = EXCLUDED.risk_level`,
          [
            newObsId,
            stayId,
            stay.rows[0].subject_id,
            savedEntry.observation_time,
            news2.respiratory_score ?? 0,
            news2.spo2_score ?? 0,
            news2.oxygen_score ?? 0,
            news2.systolic_bp_score ?? 0,
            news2.heart_rate_score ?? 0,
            news2.temperature_score ?? 0,
            news2.consciousness_score ?? 0,
            news2.total_news2_score,
            news2.risk_level,
          ]
        );
      }

      if (prevObsRes.rows.length > 0) {
        try {
          const prevReading = {
            ...prevObsRes.rows[0],
            spo2: Number(prevObsRes.rows[0].spo2),
            heart_rate: Number(prevObsRes.rows[0].heart_rate),
            systolic_bp: Number(prevObsRes.rows[0].systolic_bp),
            respiratory_rate: Number(prevObsRes.rows[0].respiratory_rate),
            total_news2_score: prevNews2Res.rows[0]?.total_news2_score,
          };
          const currReading = {
            observation_time: savedEntry.observation_time,
            spo2: v.spo2,
            heart_rate: v.heart_rate,
            systolic_bp: v.systolic_bp,
            respiratory_rate: v.respiratory_rate,
            total_news2_score: news2.total_news2_score,
          };
          trend = calculateVitalTrend(prevReading, currReading, { classify: true });

          await client.query(
            `INSERT INTO trend_results
              (stay_id, subject_id, observation_time, minutes_since_prev,
               delta_spo2, delta_heart_rate, delta_systolic_bp, delta_respiratory_rate,
               spo2_rate_per_hour, hr_rate_per_hour, sbp_rate_per_hour, rr_rate_per_hour,
               trend_classification)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              stayId,
              stay.rows[0].subject_id,
              savedEntry.observation_time,
              trend.minutes_since_prev,
              trend.delta_spo2,
              trend.delta_heart_rate,
              trend.delta_systolic_bp,
              trend.delta_respiratory_rate,
              trend.spo2_rate_per_hour,
              trend.hr_rate_per_hour,
              trend.sbp_rate_per_hour,
              trend.rr_rate_per_hour,
              trend.trend_classification,
            ]
          );
        } catch (_) {}
      }
    }

    await client.query("COMMIT");
    res.status(201).json({
      message: "Vitals recorded.",
      observation: savedEntry,
      news2,
      trend,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Record ER vitals:", e.message);
    res.status(500).json({ error: "Could not record vitals." });
  } finally {
    client.release();
  }
});

module.exports = { router, validate, news2Of };
