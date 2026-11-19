# Parvah Master Audit — B11–B14

Prepared against `main` after the B07–B10 merge, 19 November 2026.

## B11 / B12

B11's `/er-arrival` uses a transaction for case + transport linking and exposes recoverable processing failure states. B12 uses a conditional case-status update and returns 409 on lost races. Both were already changed in prior PRs. This batch does not overwrite them. Final PostgreSQL failure-injection / true concurrency checks remain on Patrika's environment checklist.

## B13 — summary snapshot semantics

`clinicalSummaryService.js` now uses `screeningStatus.js` to distinguish `NOT_RUN`, `STALE`, `COMPLETE_ZERO_FINDINGS`, and `COMPLETE_FINDINGS` rather than using `rows.length > 0` as the definition of successful screening. Includes `completed_at` and `engine_run_id` when a decision exists. The preexisting `provenance_status` and array shapes remain intact.

**Not yet complete without a migration:** Accurate durable `RUNNING` / `FAILED`, full input-version freshness checks, and independently tracked medication screening status require a versioned screening-run ledger. Existing decision-support rows alone cannot establish those facts. Patrika owns this database-dependent completion.

## B14 — ambiguous medication mapping fail-closed

* The normalization query no longer uses `DISTINCT ON` to silently select a direct map.
* Identical duplicate rows are deduplicated; mismatched canonical/status mappings and conflicting component identities raise `AMBIGUOUS_MEDICATION_MAPPING` (HTTP 422 semantics).
* Direct and component mappings on the same medication are treated as ambiguous.
* Missing/pending mappings are visible as `INCOMPLETE`, and decision-support calls normalization with `requireComplete: true` BEFORE deleting or persisting any findings.
* Mapping source table / row identifier are returned for mapped entries. `mapping_version` is explicitly `null` because the live schema has no verified mapping-version field.
* Schema-level unique constraints and real data audit remain with Patrika (B04/B14 DB work). Do not apply blind uniqueness constraints until existing duplicates have been resolved.

## Run (from repository root)

```powershell
node --test backend/test-b13-b14-offline.js
node backend/test-case-status-race.js
node --check backend/services/medicationNormalizationService.js
node --check backend/services/decisionSupportService.js
node --check backend/services/clinicalSummaryService.js
node --check backend/services/screeningStatus.js
git diff --check
```

No database or Render credentials are required for these commands. Review existing tests that mock the decision service separately; the new offline suite validates the data-mapping behavior but is not a database integration suite.

## Production gates

Do not automatically deploy this batch to the production database: B14 intentionally refuses to persist a complete screen if any medication mapping is unverified. That is a safety behavior change and requires mapping-data review, UI handling for incomplete results, and a staging run before production release.
