# Round 2 Batch B1 — T4 and T8

Scope: T4 role-scoped doctor assignment / replacement and T8 scoped ambulance-case list. T5–T7 and T27–T28 are NOT included; these are Batch B2.

## What changes
- T4: ER_STAFF and ADMIN can assign a doctor, and `replace:true` reassigns in one transaction. An existing ACTIVE assignment becomes REPLACED; the stay lock serializes updates. Without `replace:true`, return 409.
- T8: `GET /api/emergency-cases?status=&limit=&offset=` with server-side role/record-scoped count and cases. Paramedics see only their own cases, doctors only actively assigned linked cases; ER_STAFF/ADMIN have queue access. Latest linked-visit NEWS2 is supplied if present; PRE_ER unlinked cases correctly have `latest_news2:null` rather than an invented score.
- Migration 009: adds explicit replacement provenance, expands assignment status constraint, and enforces one ACTIVE assignment per stay. Run ONLY on approved isolated staging/dev DB after inspecting table structure and detecting any existing ACTIVE duplicates.

## Commands from repository root (PowerShell)
```
node backend/test-round2-b1.js
node scripts/round2-b1-patch.js --check
node scripts/round2-b1-patch.js --apply
node --check backend/routes/postEr.js
node --check backend/services/postErService.js
node --check backend/routes/emergencyCases.js
node backend/test-round2-b1.js
```

## Migration guard — no automatic production application
Before applying the SQL, query the isolated staging database:
```
SELECT stay_id, count(*) FROM public.stay_doctor_assignments WHERE status='ACTIVE'
GROUP BY stay_id HAVING count(*) > 1;
```
If any rows appear, stop for manual reconciliation; do not delete assignments. Inspect existing `chk_assignment_status` and column types in the live target schema. Apply tracked migration 009 with your existing approved migration workflow only after reviewing these facts. Do not run against production without a separate reviewed deployment plan.

## Acceptance deferred
Authenticated route tests with two roles; SQL transaction and concurrency tests; schema-drift reconciliation; real PostgreSQL migration. No release or merge claim from static tests alone.
