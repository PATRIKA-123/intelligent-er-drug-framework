"use strict";

// This is a snapshot-state interpretation, NOT a durable run history.
// RUNNING and FAILED cannot be reliably inferred from results-only tables;
// B13 needs a schema-backed run ledger for those statuses.
function classifySnapshot(decision, findings, version) {
  if (!decision) return { status: "NOT_RUN", completed_at: null, engine_run_id: null };
  const current = Boolean(decision.engine_run_id && decision.engine_version === version);
  if (!current) return { status: "STALE", completed_at: decision.created_at ?? null,
    engine_run_id: decision.engine_run_id ?? null };
  const mismatched = findings.some(f => f.engine_run_id !== decision.engine_run_id || f.engine_version !== version);
  if (mismatched) return { status: "STALE", completed_at: decision.created_at ?? null,
    engine_run_id: decision.engine_run_id };
  return { status: findings.length ? "COMPLETE_FINDINGS" : "COMPLETE_ZERO_FINDINGS",
    completed_at: decision.created_at ?? null, engine_run_id: decision.engine_run_id };
}
module.exports = { classifySnapshot };
