"use strict";
const pool = require("../db");
const VERSION = "phase6-v1";

function failureCode(err) {
  if (["AMBIGUOUS_MEDICATION_MAPPING", "INCOMPLETE_MEDICATION_MAPPING"].includes(err?.code)) return err.code;
  if (err?.statusCode === 409) return "CONCURRENT_RUN";
  return "SCREENING_FAILED"; // no PHI, stack trace or raw error in database
}
async function beginRun(stayId, id, version = VERSION) {
  try {
    await pool.query(`INSERT INTO public.screening_runs
      (engine_run_id, stay_id, engine_version, status)
      VALUES ($1,$2,$3,'RUNNING')`, [id, stayId, version]);
  } catch (err) {
    if (err.code === "23505" && err.constraint === "screening_runs_one_running_per_stay") {
      const busy = new Error("Decision-support processing is already in progress for this stay");
      busy.statusCode = 409;
      throw busy;
    }
    throw err;
  }
}
async function finishRun(id, status, drugCount, alertCount, client = pool) {
  if (!["COMPLETE_ZERO_FINDINGS", "COMPLETE_FINDINGS"].includes(status)) throw Error("Invalid completion status");
  const r = await client.query(`UPDATE public.screening_runs
    SET status=$2, completed_at=clock_timestamp(), drug_finding_count=$3, alert_count=$4
    WHERE engine_run_id=$1 AND status='RUNNING'`, [id,status,drugCount,alertCount]);
  if (r.rowCount !== 1) throw Error("Screening run completion not recorded");
}
async function failRun(id, err) {
  const r = await pool.query(`UPDATE public.screening_runs
    SET status='FAILED', completed_at=clock_timestamp(), failure_code=$2
    WHERE engine_run_id=$1 AND status='RUNNING'`, [id, failureCode(err)]);
  if (r.rowCount !== 1) throw Error("Screening run failure not recorded");
}
async function latestRun(stayId) {
  const r = await pool.query(`SELECT engine_run_id,engine_version,status,started_at,
    completed_at,drug_finding_count,alert_count,failure_code
    FROM public.screening_runs WHERE stay_id=$1
    ORDER BY started_at DESC, engine_run_id DESC LIMIT 1`, [stayId]);
  return r.rows[0] || null;
}
function statusForRun(row, kind, version = VERSION) {
  if (!row) return null;
  const stale = row.engine_version !== version ||
    (row.status === "RUNNING" && Date.now() - new Date(row.started_at).getTime() > 15*60*1000);
  const status = stale ? "STALE" : row.status === "FAILED" || row.status === "RUNNING"
    ? row.status : Number(kind === "drug" ? row.drug_finding_count : row.alert_count) > 0
    ? "COMPLETE_FINDINGS" : "COMPLETE_ZERO_FINDINGS";
  return {status,engine_run_id:row.engine_run_id,completed_at:row.completed_at,
    failure_code:row.failure_code, started_at:row.started_at};
}
module.exports = { VERSION, beginRun, finishRun, failRun, latestRun, statusForRun, failureCode };
