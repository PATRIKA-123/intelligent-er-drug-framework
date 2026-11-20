# Round 2 Batch A — safe test seeder and migration numbering

This ZIP replaces `backend/create-test-staff.js` and adds a no-DB test. It does **not** migrate any database or change the invitation routes.

Before deploying or seeding, ensure the migration `migrations/20261120_008_staff_profiles.sql` is present and that all docs reference `008`, not `005`. The earlier B13 migration already owns 005.

Commands from backend:

```powershell
node --test .\test-round2-batch-a-safety.js
node .\test-staff-invitations.js
npm test
```

To use the optional seeder **only on an explicitly designated disposable local test database**, set `PRE_ER_TEST_ENV_FILE` as appropriate, `ROUND2_CONFIRM_DISPOSABLE_SEED` exactly equal to the `DB_NAME` in the `--env` file, and `TEST_STAFF_PASSWORD` only in the terminal secret environment. Run `node create-test-staff.js --env .env.rebuild2-test`. Never use `--force`. Do not seed production or the populated audit database.

Pending T1-T3: real invitation email and database integration tests, schema migration on an approved staging DB, and clinician-role authorization verification.
