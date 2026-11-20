PARVAH Round 2 migration check — local address guard fix

Cause: original preflight rejected inet_server_addr() when a localhost connection
was forwarded through Docker, WSL or local networking. That server-side value
need not be a loopback address even though the client explicitly connects to
localhost.

Fix: only removes the redundant server-reported-address check. Still requires:
- Explicit ROUND2_STAGING_READONLY=YES and exact staging database name
- DB_HOST of localhost/127.0.0.1/::1 from backend/.env.pre-er-test
- No DATABASE_URL / PG* ambiguous overrides; no production mode or DB_SSL
- Actual current_database() == intelligent_er_drug_test
- Read-only preflight; dry run executes in transaction always rolled back

Extract files into repository root, overwriting the original staging script.

PowerShell:
  node --test tests/test-round2-migration-guard-fix.cjs
  node scripts/round2-migrations-staging.cjs --preflight

Only if preflight says OK:
  node scripts/round2-migrations-staging.cjs --dry-run

Never apply migrations to live clinical data. Do not run dry-run against shared,
production or non-disposable systems.
