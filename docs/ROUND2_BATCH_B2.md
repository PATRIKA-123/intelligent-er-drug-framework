# Round 2 Batch B2 — T5/T6/T7

This is **implementation code** with offline checks. SQL migration and real PostgreSQL integration tests remain pending. Do not deploy this code before applying `migrations/20261120_010_patients_visits.sql` on an isolated, schema-checked staging DB. B1 `009` migration is also required for doctor assignment history.

## Install, from repository root

1. Extract ZIP preserving paths. Do not overwrite local modifications unexpectedly.
2. `node --test backend/test-round2-b2.js`
3. `node scripts/round2-b2-patch.js --check`
4. `node scripts/round2-b2-patch.js --apply`
5. `node --check backend/config/httpSecurity.js; node --check backend/server.js; node --check backend/routes/preEr.js; node --check backend/routes/patients.js; node --check backend/routes/visitRegistration.js; node --check backend/services/round2Registration.js`
6. `node --test backend/test-round2-b2.js && git diff --check` (PowerShell: run separately).

## New APIs
- `GET /api/patients?q=&limit=25&offset=0` ADMIN, ER_STAFF, DOCTOR; requires >=2 search chars; max 50, only selected columns, scoped by role. **Needs finer record-level scope policy before clinical deployment.**
- `POST /api/patients` ADMIN, ER_STAFF; optional demographics, all absent = temporary.
- `POST /api/stays` ADMIN, ER_STAFF; requires `Idempotency-Key` 12-128 chars; patient_id OR patient, optional case_id/doctor_user_id/chiefcomplaint/acuity. Creates patient, stay, case link, doctor assignment, visit code, idempotency record transactionally. Access code visible exactly once. Replays return stay_id but no code.
- `POST /api/emergency-cases/:id/er-arrival`: shares link policy and preserves HANDOVER_COMPLETE transport; after-commit processing errors return 202 rather than 500.

**Security limits:** Automatic demographic profile linking is deliberately disabled pending T20/T28 reviewed association. No identity claim endpoint is exposed until T12/T27 verification. New visit with no clinical inputs remains PENDING_INPUTS, not a calculated normal NEWS2. Patient search is staff-only; doctors are restricted in SQL to patients with an active doctor assignment, while further two-user data-access and auditing tests (T24) remain mandatory. Date of birth and personal info are not printed in logs. A full clinical approval gate remains before production.

**Migration preflight:** Confirm table definitions/types and sequences in an isolated staging schema. Ensure existing maximum IDs are below `9000000000` patients subject ID and `90000001` stay ID; otherwise adjust START values in a reviewed migration. No migration applies automatically. Do not use production for testing. Build a database-backed fixture covering forced rollback, duplicate idempotency keys, cross-patient link rejection, and transport HANDOVER_COMPLETE preservation.

**T7 admin unlink intentionally deferred:** Unlink/relink is high-risk and requires the T28 reviewed identity-correction and clinical-history-preservation workflow. No destructive unlink route is introduced by this patch.
