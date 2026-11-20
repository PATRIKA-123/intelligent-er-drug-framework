# PARVAH migration 009-012 staging review

This is a review package only. It **cannot apply migrations permanently**.

Run from your repository root after extracting the `scripts` and `tests` folders:

```powershell
$env:ROUND2_STAGING_READONLY = 'YES'
$env:ROUND2_STAGING_DB_NAME = 'intelligent_er_drug_test'
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --test tests/test-round2-migration-guard.cjs
node scripts/round2-migrations-staging.cjs --preflight
```

If preflight is green, only then:

```powershell
node scripts/round2-migrations-staging.cjs --dry-run
```

The script requires `backend/.env.pre-er-test`, uses the pg driver already in `backend/node_modules`, rejects non-local and unexpected database targets, inspects duplicate active doctor assignments and sequence collisions, checks for partially applied migrations and performs SQL validation in a transaction that is **always rolled back**. Dry-run performs SQL statements transiently; execute **only on isolated disposable local test DB**. Never use real patient data. Dry-run may hold locks briefly and is not a production migration strategy.

Migration 011 intentionally backfills `visit_status='DISCHARGE_AUTHORIZED'` for existing discharged stays; count is shown in preflight. Manual review is needed before committing. Migration 012 uses `CREATE TABLE` without `IF NOT EXISTS`, so do not rerun after partial application. Validate against actual production schema separately before any production migration approval.

If preflight or dry-run fails, stop and share output (no passwords or JWT secrets). Do not apply manually.
