# B04 — Automated fresh rebuild (disposable local database only)

This is a *new* script; it does not overwrite the existing `b04-bootstrap-test-db.js` or original `schema-export.sql`. It retains an **exactly 21 directives** allowlist for the incompatibility with PostgreSQL 18.4, and refuses any unexpected `pg_attver`. The raw schema dump stays unchanged. Only operate on a newly created **empty** local database.

## From backend PowerShell

1. The old `intelligent_er_rebuild_test` has already been manually populated. **Do not run `--apply` against it.** Create a *new* disposable database:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h localhost -U postgres intelligent_er_rebuild2_test
```

2. Copy only the local test environment to `.env.rebuild2-test` and set `DB_NAME` and `PRE_ER_TEST_DATABASE_NAME` to `intelligent_er_rebuild2_test`, set `DB_HOST=localhost` and `DB_SSL=false`.

3. In the backend shell:

```powershell
$env:PRE_ER_TEST_ENV_FILE = ".env.rebuild2-test"
$env:B04_ALLOW_DISPOSABLE_BOOTSTRAP = "YES"
$env:B04_CONFIRM_EMPTY_REBUILD = "intelligent_er_rebuild2_test"
$env:PSQL_PATH = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
node --test .\test-b04-rebuild-verified.js
node ..\scripts\b04-rebuild-verified.js --apply
node ..\scripts\b04-rebuild-verified.js --verify
node ..\scripts\b04-rebuild-verified.js --verify
```

The initial `--apply` must print `B04_AUTOMATED_REBUILD_VERIFIED`; the repeated `--verify` commands must report valid checksum records. A second `--apply` must refuse to modify the now-populated schema; to test that safeguard, run it only if explicitly desired.

A failed migration leaves a partial rebuild DB requiring a **new empty disposable DB**, never silent repair/replay. Do not use for remote or production deployment. CLI output includes schema metadata; keep logs private. Do not commit `.env.*` files or local database inventories.

## Limits

- Does not restore patient or application rows; schema-only by design.
- Does not verify privileged cloud deployment or the existing populated database.
- B04 is closed only after the user's actual local automated apply and verify outputs pass.
- The runner requires the known repository dump format and exact migration files. Future migrations require an explicit allowlist update and new regression tests.
