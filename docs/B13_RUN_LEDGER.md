# B13 — Persistent screening-run ledger (audit 1)

## Scope and limitations

Adds `public.screening_runs` and connects the existing decision-support processing service to a persistent run lifecycle. A successful run's drug and alert counts determine `COMPLETE_ZERO_FINDINGS` versus `COMPLETE_FINDINGS`; a failure is written **after** the clinical transaction rolls back. The summary reads the most recent ledger row. No prior clinical findings are deleted by the migration. The current processing service still replaces live result snapshots—**B22 remains open**. Database writes are NOT performed by offline tests.

The run table is durable but not a comprehensive immutable clinical outcome archive. No historical screening runs are fabricated. Crashed processes can leave `RUNNING` rows; the reader calls these `STALE` after 15 minutes, while the unique index prevents a new run until the stale row is reviewed and explicitly resolved. This is conservative rather than silently restarting clinical processing. Completion status is written after the clinical commit; if that second write fails, the ledger remains unresolved and should be investigated.

## From backend/ on the already-authorized disposable database

```powershell
$env:PRE_ER_TEST_ENV_FILE = ".env.pre-er-test"
node --test .\test-b13-ledger-offline.js
node ..\scripts\b13-patch-services.js --check
node ..\scripts\b13-local-migrate.js --verify
$env:B13_CONFIRM_LOCAL_TEST = "intelligent_er_drug_test"
node ..\scripts\b13-local-migrate.js --apply
node ..\scripts\b13-local-migrate.js --verify
node ..\scripts\b13-patch-services.js --apply
node --check .\services\alertService.js
node --check .\services\clinicalSummaryService.js
node --test .\test-b13-ledger-offline.js
```

Before `--apply`, confirm `PRE_ER_TEST_ENV_FILE` targets `intelligent_er_drug_test` on localhost and contains only disposable test records. Restart the backend server after the migration.

### B13 database verification

```sql
SELECT status, count(*) FROM public.screening_runs GROUP BY status;
SELECT engine_run_id, status, drug_finding_count, alert_count, failure_code
FROM public.screening_runs ORDER BY started_at DESC LIMIT 5;
```

**End-to-end closure requires** a controlled test screening that successfully completes, a controlled failed screening (with rollback), evidence of zero-findings classification, and API summary state matching the ledger. Do not call the finding complete based solely on the table and offline checks.
