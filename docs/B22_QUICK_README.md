# B22 — append-only clinical results (quick patch)

No database migration is required: existing tables already hold `engine_run_id` and `engine_version`.

From `backend`:

```powershell
node --test .\test-b22-append-only.js
node ..\scripts\b22-append-only-patch.js --check
node ..\scripts\b22-append-only-patch.js --apply
node --check .\services\alertService.js
node --check .\services\decisionSupportService.js
node --check .\services\drugSafetyService.js
node --check .\services\clinicalSummaryService.js
node ..\scripts\b22-append-only-patch.js --check
```

The script never connects to the database. It checks all source anchors before applying changes; a second `--apply` does nothing.

**Scope:** It stops replacement deletes, scopes alert generation to the current run's drug results, and reads only one run's findings in clinical summaries. It intentionally does not make tables DB-enforced immutable (UPDATE/DELETE permissions, triggers), and does not adjust legacy tests that expect only one row per stay. Those remain for later verification/hardening. No B13 or B10 migration or historical backfill is needed.

**Caution:** Do not run old integration scripts which assert single-row snapshots against a populated database without reviewing them; those scripts predate append-only run histories.
