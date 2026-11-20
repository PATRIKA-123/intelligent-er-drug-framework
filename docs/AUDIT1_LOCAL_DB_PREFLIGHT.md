# Audit 1 / Wave 1 — local database schema preflight

**Purpose:** Check Patrika's local disposable PostgreSQL test database before authoring migrations for B04, B09, B10 and B17. This is not a production migration or a fix by itself.

## Safe usage
1. Extract ZIP to repository root, retaining `scripts/` and `docs/`.
2. Check `.env` locally. Required: `DB_HOST=localhost`, `DB_NAME=intelligent_er_drug_test`, `PRE_ER_TEST_DATABASE_NAME=intelligent_er_drug_test`, your own `DB_USER` and password; use another matching name ending `_test` or `_ci` if appropriate. Never paste password or JWT secret into chat.
3. From repository root run `node scripts/audit1-db-preflight.js > audit1-db-inventory.json`.
4. Open the resulting JSON, review it for any local identifying table/constraint names, and share it for planning the migration. The script queries **schema metadata only** (no patient rows, no password, no clinical values).
5. Keep `audit1-db-inventory.json` out of Git unless approved; it's diagnostic output only.

The script requires localhost and a database name explicitly matching `PRE_ER_TEST_DATABASE_NAME` and ending `_test`/`_ci`, starts a READ ONLY transaction, and does not modify the schema or records.

**Next implementation batch after inventory:** B04 reproducible baseline/migrations; B09 temperature Celsius and provenance; B10 assumed-input flags; B17 outlier flagging and de-identified timestamp handling. Use independent migration IDs, safety guards, isolated DB smoke tests, and reversible changes where feasible.
