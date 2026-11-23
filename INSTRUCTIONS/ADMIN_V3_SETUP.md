# Parvah Admin v3 — verified test-data cleanup and interactive analytics

This is an **incremental ZIP patch over your already installed v1 and v2 admin patches**. It does not contain the entire repository. Extract into the root of `intelligent-er-drug-framework` on your existing `frontendfix` branch, using overwrite. Do **not** extract into `backend` or `frontend` alone.

## Exactly what changes

- `backend/routes/adminTestCleanup.js` (new): a role-restricted, explicit-ID, dry-run/execute test cleanup API. The API previews the exact selected accounts, related cases and pre-ER child record counts. The destructive endpoint compares a SHA-256 manifest digest to the current DB state, requires a 12+ character reason and `DELETE VERIFIED TEST DATA`, uses a serializable transaction, recomputes foreign-key checks, and writes `admin_action_audit`.
- `backend/server.js`: mounts `/api/admin/test-cleanup`.
- `backend/routes/adminManagement.js`: includes closed cases in the operational case listing (still capped at 1,000 most recent rows).
- `frontend/src/pages/AdminVerifiedPurge.jsx` (new): selection, manifest review, safety acknowledgment, typed confirmation.
- `frontend/src/pages/AdminUsers.jsx`: new cleanup flow for selected staff accounts, including all cases they created.
- `frontend/src/pages/AdminOperations.jsx`: includes closed cases, case status filter, new selection/preview UI.
- `frontend/src/components/AdminRightPanel.jsx`: interactive Accounts/Invites/Operations tabs, clickable role breakdowns, assignment coverage and manual Refresh.
- `frontend/src/api/admin.js`: calls the new endpoints.

## What WILL be deleted after manual verification

For selected cases: the `emergency_cases` rows and their `pre_er_assessments`, `pre_er_vitals`, and `ambulance_transports` rows. For selected staff accounts: their created emergency cases and the above case records, plus account-specific invitations, password-reset tokens and staff/doctor profiles. Existing audit history is retained; a new audit entry records a manifest reference and a human-entered reason.

## What will NEVER be deleted by this feature

- `ed_stays` ER visits, `patients` and patient portal accounts, prescriptions, doctor assignments, other ER clinical records, and administrator accounts.
- Case-linked ER visits are **preserved** and their IDs are explicitly displayed in the preview. Removing a case WILL sever its pre-hospital history and case link. Do not clean cases where that provenance is still required.
- An account referenced by unrelated clinical/operational rows is blocked; for example, a doctor with stay assignments may remain ineligible. That is intentional. A linked ER visit alone does not block *case* removal because its row is not deleted.
- Any new/unknown foreign-key child table containing related rows blocks deletion. A complex foreign key also blocks deletion; we do not use arbitrary cascades.

The system **cannot independently determine which records are genuine test data**. Search terms like `test` are only aids to selection, not verification. You must personally verify the names, case IDs, linked stay IDs and dependent record counts before deleting. The preview is all-or-nothing; failed dependency checks or concurrent data changes cause rollback. Each batch can contain 1–100 manually selected IDs and up to 1,000 derived cases. The Operations page lists up to 1,000 most recent cases; older cases are not displayed on this page.

## Required preparation BEFORE permanent cleanup

1. In Neon, create a restore point / a backup with a tested restore path. The SQL already applied to `pravah2` is unchanged; **there are no new database migrations**.
2. Make sure you are on the existing `frontendfix` branch:

```powershell
git branch --show-current
git status --short
```

3. Extract `parvah_admin_v3_frontendfix.zip` to the **repository root**, overwriting matching paths:

```powershell
Expand-Archive -Path "$env:USERPROFILE\Downloads\parvah_admin_v3_frontendfix.zip" -DestinationPath . -Force
```

4. From `frontend`, run `npm ci`, `npm run build`, `npm run lint`. Preserve your existing `.env.local` (`VITE_USE_MOCK=false`, `VITE_API_BASE=https://intelligent-er-drug-framework.onrender.com`).
5. Run the normal backend tests in CI before deploying. **Do not operate the deletion controls while the old backend is still running**. New endpoints return 404 until the new code is deployed.

## Use the existing Render backend (no new service or branch)

Push only your existing `frontendfix` branch **when ready**; ChatGPT has not committed or pushed anything:

```powershell
git add backend/server.js backend/routes/adminManagement.js backend/routes/adminTestCleanup.js frontend/src/api/admin.js frontend/src/components/AdminRightPanel.jsx frontend/src/pages/AdminUsers.jsx frontend/src/pages/AdminOperations.jsx frontend/src/pages/AdminVerifiedPurge.jsx INSTRUCTIONS/ADMIN_V3_SETUP.md
git commit -m "feat: verified test cleanup and admin analytics"
git push origin frontendfix
```

In Render, deploy that branch using the existing service (if it currently tracks `main`, change its deploy branch to `frontendfix` before deploying). This **will affect the running service**, so schedule it appropriately. `DB_HOST`, `DB_NAME=pravah2`, `DB_SSL=true`, Brevo and other environment variables remain unchanged. No direct changes to Neon are required. Merge into `main` only after verification.

## Test safely, in this order

1. Verify the four admin pages load and the right analytics panel tabs, refresh, clickable filters, and quick links work. Ensure the frontend uses the newly deployed Render backend, not mock mode.
2. Verify the Operations page can show CLOSED cases and filter by status.
3. Select ONE definitely disposable test case. Choose Preview. Check the case code, creator, status, linked visit, assessment/vital/transport counts. Preview must not modify data.
4. Confirm a non-admin user cannot call `/api/admin/test-cleanup/preview` or `/execute` (403). An unauthenticated caller should receive 401.
5. Test refusal for admin account deletion and for an unrelated real staff account with clinical assignments. No data should be deleted.
6. On a disposable test database/Neon branch **first**, make a small deletion with the reason, checkbox and typed phrase. Verify the audit and the case/account counts. Test a stale preview: add/change a dependency after preview; execution must reject or roll back.
7. After verifying the workflow, you may clean confirmed disposable records in the Neon branch used by your existing Render service. Use account cleanup for accounts and their cases; then use case cleanup for remaining test cases. Repeat in batches. Never treat a bulk list as automatically test-only.

## Read-only audit SQL for Neon

```sql
SELECT audit_id, actor_user_id, action, target_type, target_id, created_at
FROM public.admin_action_audit
ORDER BY created_at DESC LIMIT 30;
```

## API contract

`POST /api/admin/test-cleanup/preview` with authenticated ADMIN token and `{ "kind":"users"|"cases", "ids":[1,2,3] }` returns `{ eligible, blockers, summary, digest }`. `summary` lists users and all included cases, each case's pre-hospital child counts, and linked ER/patient IDs that are preserved.

`POST /api/admin/test-cleanup/execute` requires `{ "kind": "users"|"cases", "ids": [..], "reason": "...", "digest": "64 hex SHA-256 manifest digest", "verification": "DELETE VERIFIED TEST DATA" }`. It rechecks the plan under a serializable transaction. A rejected request never partially deletes data.

## Important limitations / troubleshooting

- If an account was used to assign a doctor, prescribe medication, create audit events, or perform other actions not included in its own cases, deletion may be blocked. Such records must be reviewed and retained or handled by a separate explicit correction process; this patch does not auto-erase them.
- A linked case may be deleted while its ER visit remains. The preview warns you of the loss of pre-ER provenance; do not use this on genuine clinical data.
- A new FK relationship added after this patch is written will block deletion. This is safer than silently deleting unknown medical records.
- If Render gives 404 for the new preview endpoint, deploy the new backend first. If you get 409, refresh the preview; if the dependency is truly real, don't delete it.
- This ZIP has been checked for JavaScript and JSX syntax and path layout, but no live deletion against your Neon database was performed. The full frontend build and Render integration tests still need to run before destructive use.
