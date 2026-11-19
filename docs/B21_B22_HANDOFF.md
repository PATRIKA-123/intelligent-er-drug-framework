# Audit 1 — B21 and B22: regression / database handoff

Base: repository `PATRIKA-123/intelligent-er-drug-framework`, main, 19 November 2026.

## B21 (Post-ER invariants)
Existing code locks the stay, checks active doctor assignment, prevents repeated discharge, locks the prescription row during review, and requires a `SCREENED` status before authorization. The existing `backend/test-post-er-invariants.js` exercises these with a fake DB. New `backend/test-b21-b22-offline.js` checks that these protections remain in the source.

Remaining for Patrika on an isolated database: two simultaneous prescription reviews, doctor reassignment overlapping prescription authorization, discharge racing with a new prescription, test that rejected/incomplete screenings cannot be approved, and durable audit trail for actor, action, decision, and timestamp. Consider a conditional `UPDATE ... WHERE status='PENDING_REVIEW' RETURNING` as further defense. Test realistic isolation and uniqueness constraints. These are NOT proven by offline assertions.

## B22 (clinical processing integrity)
Existing alert service acquires `pg_try_advisory_xact_lock` per stay, shares a transaction across alert, decision and interaction persistence, and rolls back failures. A shared `engineRunId` and `engineVersion` identify new result rows.

**Unresolved critical gap:** current `DELETE ... WHERE stay_id` replaces active rows; old successful runs are not stored as immutable history. `engine_run_id` on a current snapshot does NOT satisfy versioned audit history. For Patrika: introduce append-only `clinical_processing_runs` with status `RUNNING/COMPLETE/FAILED`, actor ID, timestamps, input hash/version, code/rules version and non-sensitive outcome; archive per-run findings or store immutable snapshot tables with FK to run ID. Update the current-run pointer only after a successful transaction; do not overwrite previous completed results. A failed run must preserve the last complete run. Add failure injection and true parallel PostgreSQL tests.

## Commands — from repository root
```
node --test backend/test-b21-b22-offline.js
node backend/test-post-er-invariants.js
node --check backend/test-b21-b22-offline.js
git diff --check
```

Do not run database integration tests against production Neon/Render. Existing source plus offline tests represent **implementation evidence**, not full closure of either issue.
