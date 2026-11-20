# PARVAH Round 2 — Batch F release verification (v1)

**Scope:** T15, T29, migrations 009–012, reconciliation of A–E. This is a **verification package**, not a production migration or a medical device clearance. Nothing in this ZIP performs schema/data writes.

## 1. Local verification (repository root, Windows PowerShell)

```powershell
node --test tests/test-round2-f.cjs
node scripts/round2-f-audit.cjs
node --test backend/test-round2-b1.js backend/test-round2-b2.js backend/test-round2-c.js backend/test-round2-d.js
node --test frontend-tests/test-round2-e.cjs
cd frontend
npm run build
npm run lint
cd ..
git diff --check
git status --short
```

The static audit **always** says `NO_GO_UNTIL_GATES_VERIFIED`, even if all source checks pass. This is intentional: a source scan cannot prove safe database runtime behavior. Lint's existing 24 warnings are cleanup items, not evidence of a successful API test. The `--json` switch prints a JSON report for saving locally without secrets.

## 2. Staging prerequisite (manual — do not bypass)

- Create an **isolated, disposable Neon/PostgreSQL staging database** with representative synthetic fixtures, not production patient records.
- Inventory existing tables/constraints/indexes, check branch and data source, and take a verified recovery snapshot. Confirm all migrations 001–008 have been applied correctly.
- **009:** Check for multiple `ACTIVE` doctor assignments per stay *before* creating the partial unique index. It must not delete historical assignments or auto-correct discrepancies.
- **010:** Verify both new BIGINT sequences cannot collide with the actual highest IDs. Compare `max(stay_id)`, `max(subject_id)` in staging and check foreign keys, unique indexes and idempotency behavior.
- **011:** Review `UPDATE public.ed_stays ... WHERE EXISTS(discharges)` before running; it changes existing records' visit status. Validate clinical semantics and counts on staging, and confirm `round2_visit_status_check` is not duplicated.
- **012:** Check current tables before `CREATE TABLE` statements, since many are not `IF NOT EXISTS`. Confirm no data/table name collisions and that access/audit constraints are correct.
- Apply **009 then 010 then 011 then 012**, manually, **only on staging**, with `ON_ERROR_STOP` and an approved rollback/rebuild plan. Do not paste live database URLs into chat/logs. The release verifier intentionally does not run these migrations.

## 3. Optional READ-ONLY database probe after staging migrations

This uses `pg` already installed under `backend/node_modules` and an existing staging connection in the current PowerShell session. It never loads `.env` or prints connection strings, access tokens, patient records, or passwords. Set the variables in the session explicitly (do not put secrets in commands you share):

```powershell
# Only after configuring your existing staging DB_* or DATABASE_URL connection.
$env:ROUND2_STAGING_READONLY = "YES"
$env:ROUND2_STAGING_DB_NAME = "<EXACT_DISPOSABLE_STAGING_DATABASE_NAME>"
node scripts/round2-f-staging-readonly.cjs
```

If you see `DATABASE NAME MISMATCH`, stop. If columns/indexes are missing, do not forge/patch them manually: reconcile the recorded migration state. This probe performs `BEGIN READ ONLY`, schema catalog checks and **aggregate-only** duplicate-assignment checks; it deliberately does **not** verify complete end-to-end functionality. It does not guarantee you are on a nonproduction server merely because a database is named staging: independently verify the host/project is isolated.

## 4. Five-role API acceptance matrix (synthetic staging only)

| Role | Must succeed | Must be denied |
|---|---|---|
| ADMIN | Reviewed staff invitations, authorized correction decisions, audit views | Claim a visit as patient without patient role |
| ER_STAFF | Board, patient search, register stay, assign/replace doctor, record arrival and departure, scoped follow-ups | Unrestricted historical records; unauthorized identity ownership |
| DOCTOR | Only actively assigned stays, vitals, screening and authorized discharge | Other doctors' stays; bypass screening/acknowledgement; override physical departure |
| PARAMEDIC | Create case, update own case, transport/handover, see own case queue | Global patients, clinical histories, unrelated cases |
| PATIENT | Own profile and self-reported data; submit visit claim; access after staff verification and consent | Immediate access on code match; any other patient's visits; staff/doctor records |

Test both successful and denied paths (401/403), idempotent replay, conflicting idempotency body (409), consecutive registration, two simultaneous claim submissions, expired/used/revoked codes, reassignment races and partial vital entries. Verify that no protected data appears in denied responses, application logs, or API error bodies.

## 5. Clinical/safety acceptance (qualified reviewers)

- NEWS2 Scale 1/2 verification against approved independent cases; Scale 2 only on documented clinician authorization; no NEWS2 for missing/assumed inputs unless explicit documented policy permits.
- Medication identity provenance, unmapped/ambiguous components and pair coverage: never show `SCREENED` when incomplete; prescription authorization is server-enforced and requires acknowledgement of significant interactions where policy requires it.
- Discharge vs physical departure: only actively assigned doctor authorizes discharge, ER staff records departure after authorization; confirm prescription review cannot be bypassed.
- Latest score freshness, stale results, pending/failed processing and alert lifecycle reported honestly (the current board may label freshness `UNVERIFIED_FRESHNESS`).
- Patient consent history and independent identity verification with audited correction/unlink/relink. Ensure no silent DOB/phone linking.

## 6. Known remaining engineering gaps / non-claims

The preceding batches passed **offline structure/syntax/build checks**, not full database and clinical acceptance. Among known remaining items:
- A usable admin identity-review UI is not yet demonstrated by the Batch E frontend adapter.
- Longitudinal visit histories, robust multi-instance rate limiting, patient password-change session revocation and other D hardening need acceptance evidence.
- T26 prescription ACK/discharge controls and T25 freshness require explicit end-to-end/security and clinical review. A checkbox in the UI alone is insufficient.
- Reproducible migrations from a clean clone, source CSV constraints and safe teardown/rollback remain unverified.

**Final release decision is NO-GO until the above gates have actual test evidence and reviewers sign off.** After acceptance, push a reviewed branch / PR; do not merge/deploy automatically from this package. Rollback should be an approved restore/rebuild strategy, not an improvised down-migration on live clinical records.
