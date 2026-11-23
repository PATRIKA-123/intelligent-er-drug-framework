# PARVAH Admin UI v2 — replacement patch

This ZIP **updates the previous admin ZIP**. Extract into the same repository root. It does **not** replace your entire project, reset accounts, or run SQL.

## What changed

- **Left navigation:** admin-only rail: Invite, Invitations, Users, Operations, logout; original ER and paramedic navigation is unchanged.
- **Right sidebar:** account, invitation, and operations analytics based on actual database totals; visible on wide screens (>= Tailwind `xl`). Top summary counters have been removed from Users and Operations.
- **Dialogs:** centered React dialogs replace `window.prompt` and `window.confirm` in the admin management screens.
- **Users:** separate Deactivate / Reactivate / Password reset / Delete account actions; selectable staff accounts and batch cleanup.
- **Operations:** current case/ER patient tabs; selectable unlinked PRE_ER cases and batch cleanup.
- **Invitations:** centered resend and unused-account deletion confirmations.
- **Backend:** new admin-only cleanup preview/execute routes and analytics summary route. All deletions have an audit record.

## Extract into your existing `frontendfix` branch

In PowerShell from the `intelligent-er-drug-framework` root:

```powershell
git branch --show-current
git status --short
# It must be frontendfix. Preserve any unrelated pending changes before overwriting files.
Expand-Archive -Path "$env:USERPROFILE\Downloads\parvah_admin_v2_frontendfix.zip" -DestinationPath . -Force
git status --short
```

Note: the ZIP only contains *relative paths rooted at the repository root*. Do not extract into `frontend/` or `backend/` directly. No files are pushed or committed by ChatGPT.

## Neon

**No new SQL migration is required.** The earlier `20261123_013_admin_management.sql` has already been applied to `pravah2`; it created `admin_action_audit` and `admin_password_resets`. The new cleanup feature reads and writes the existing tables. Do not rerun all migrations or reset any Neon tables.

Before any actual cleanup of test records, take a Neon point-in-time restore point or create a database backup / branch. Use the UI's **preview**; do not mass-select production records. This feature never auto-identifies test records (there is no verified `is_test` flag in the existing database).

## Render — use your existing service

The backend file changes cannot take effect until your existing Render backend has been redeployed with them. Your local frontend **cannot enable backend endpoints by itself**.

1. Preserve your existing working `frontendfix` branch and files.
2. Check the frontend build locally (`cd frontend; npm ci; npm run build; npm run lint`) and existing backend CI tests once pushed.
3. When ready, commit and push **to `frontendfix` only** from the repository root:

```powershell
git add frontend/src/pages/AdminDialog.jsx frontend/src/pages/AdminCleanup.jsx frontend/src/pages/AdminUsers.jsx frontend/src/pages/AdminOperations.jsx frontend/src/pages/AdminInvitations.jsx frontend/src/components/AppShell.jsx frontend/src/components/AdminSideRail.jsx frontend/src/components/AdminRightPanel.jsx frontend/src/api/admin.js backend/server.js backend/routes/adminManagement.js backend/routes/adminCleanup.js INSTRUCTIONS/ADMIN_V2_SETUP.md
git commit -m "feat: improve admin navigation, analytics and guarded test cleanup"
git push origin frontendfix
```

4. In the **existing Render Web Service**, if it currently deploys `main`, temporarily change its deployment branch to `frontendfix` to test this patch, and deploy the latest branch commit. This changes the running service; schedule the test appropriately. Do not create another service unless you choose to.
5. After final approval, merge `frontendfix` into `main` and point Render back to `main` if you changed its source branch.

The existing Render environment variables (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `JWT_SECRET`, `CORS_ORIGINS`, `FRONTEND_URL`, Brevo variables) remain unchanged. The frontend `.env.local` still needs `VITE_USE_MOCK=false` and `VITE_API_BASE=<your existing Render URL>`.

## New API contract

All are under `POST /api/admin/cleanup/...` and require an active ADMIN JWT. Requests are JSON.

- `POST /api/admin/cleanup/preview` body `{ "kind": "users" | "cases", "ids": [positive integers] }` — returns all eligible/blocked selections with reasons. Maximum 25 per batch.
- `POST /api/admin/cleanup/execute` body `{ "kind": "users" | "cases", "ids": [..], "reason": "at least 10 chars", "confirmation": "DELETE N" }` — all-or-nothing transaction; checks eligibility again, deletes only if **every** selected entry remains eligible, writes to `admin_action_audit`.
- `GET /api/admin/management/summary` — admin-only counts.

**User hard deletion rules:** only DOCTOR, ER_STAFF, PARAMEDIC accounts may be selected. A referenced account is blocked, including staff who own clinical cases or have doctor assignments. ADMIN and PATIENT accounts cannot be hard-deleted through these endpoints. Those can be managed through a separately reviewed process. Password resets remain available for active, invited staff with an email.

**Case hard deletion rules:** only an unlinked `PRE_ER` placeholder with `patient_id` and `stay_id` both null and NO assessments, vitals, ambulance transport or other referencing records is eligible. Linked ER cases or cases containing clinical information must be retained or handled through a separately reviewed correction workflow.

This is intentional: **a label or pattern like `test` is not reliable proof that a case is safe to erase**. The database may include patient or medical records tied to some of your old tests. We therefore do not provide a dangerous 'delete everything' action. Select known test records in batches; inspect blocked details.

## Verification checklist

1. Verify all four admin pages and left-rail navigation; verify logout remains accessible.
2. Check that the right panel displays counts on wide (`xl`) screens; counts are full database totals, and are refreshed on navigation.
3. Verify centered confirmations for resend, account status, password reset, user deletion, case deletion.
4. On Users, select a few known unused staff accounts and click **Review deletion**. Confirm the server returns eligible/blocked results. Try a batch with one deliberately blocked account; **nothing should be deleted**.
5. Take a backup/restore point, then test a single *known disposable* unlinked PRE_ER case; verify a corresponding row in `admin_action_audit`.
6. Check that selecting an assigned doctor or a linked case is blocked.
7. Test role separation: DOCTOR/ER_STAFF/PARAMEDIC/PATIENT must not be able to call the new admin endpoints.
8. Recheck invitations and ER/paramedic flows for regression.

### Useful, safe SQL in Neon

```sql
SELECT created_at, actor_user_id, action, target_type, target_id, reason
FROM public.admin_action_audit
ORDER BY created_at DESC LIMIT 30;
```

No credentials should be pasted into GitHub, screenshots, the ZIP, or chat.

## Validation performed for this ZIP

- All new/changed JS and JSX files were parsed with TypeScript's JS/JSX parser.
- Backend files were checked with `node --check`.
- ZIP paths were inspected.

**Not performed:** full `npm run build`, backend integration tests, or execution against Neon/Render. These require the complete repository dependencies and a test environment. Do not perform bulk destructive actions until validation succeeds.
