# PARVAH — Admin Redesign / frontendfix

**Status:** ZIP-only local patch. No GitHub changes were made by ChatGPT.

## What is included

The ZIP is an **overlay** to extract at the repository root, keeping existing paths. It contains 11 modified/new application files, one SQL migration, and these instructions. It intentionally **does not** include the entire repository or `.env`, secrets, or dependencies.

| Page | URL | Behavior |
|---|---|---|
| Invite | `/admin` | Existing `AdminDoctors.jsx` invitation page unchanged. |
| Invitations | `/admin/invitations` | Historical invitations for doctors, ER staff and paramedics; created/expiry/accepted times; status; resend; delete never-accepted account. |
| Users | `/admin/users` | Role search/filter, active/deactivated users; deactivate/reactivate with reason; email a secure password-reset link to accepted active staff; delete unused invited accounts. |
| Operations | `/admin/operations` | Open emergency cases, all currently non-departed ER visits within a 300-row cap, assigned doctor, paramedic, search, and tightly restricted deletion of empty false cases. |
| Password reset | `/reset-password?token=...` | 30-minute one-use token; only token hash stored in Neon. |

**Safety decisions**:
- We do **not** delete active doctors, paramedics, ER staff, patient accounts, or any clinical history from the directory. Deactivation blocks login and API access. Deactivation and reactivation require a reason.
- Account deletion uses the repository's **existing** doctor/staff deletion endpoints, which reject activated/previously used accounts.
- 'Delete false case' is **only** for an unlinked `PRE_ER` placeholder with no assessment, pre-ER vital, or ambulance transport. A clinical case or any case linked to an ER stay is explicitly blocked. Foreign-key constraints block other dependencies. Deletion writes an admin audit record.
- Admin password reset is only for **active staff who accepted an invitation**, not patient accounts or admin accounts; the account owner completes the change via emailed link. Passwords are never displayed to admin.
- This introduces no new clinical decision-making or automatic changes to doctor assignment.

## Step 1 — Create a SEPARATE branch (important)

Open PowerShell **in the repo root**, then:

```powershell
git status --short
git switch main
git pull --ff-only origin main
git switch -c frontendfix
```

If `frontendfix` already exists, run `git switch frontendfix` instead of `git switch -c`. **Do not run `git switch main` if `git status --short` shows uncommitted work you need to preserve.** Stash/commit your own work to a separate backup branch first. Keep the working branch as `frontendfix` for every change in this patch.

## Step 2 — Extract the ZIP IN THE REPOSITORY ROOT

The ZIP starts with folders `backend/`, `frontend/`, `migrations/`, and `INSTRUCTIONS/`, **not** an extra enclosing directory. Extract it with *Extract All* into the folder containing your existing `backend` and `frontend`, and allow overwrites when prompted. **Do not delete or replace the entire `backend`/`frontend` folders.**

Alternative, from the repo root:

```powershell
Expand-Archive -Path "C:\path\to\parvah_admin_frontendfix.zip" -DestinationPath . -Force
git status --short
git diff -- frontend/src/App.jsx frontend/src/auth/roles.js frontend/src/components/AppShell.jsx backend/server.js
```

Verify `git branch --show-current` outputs `frontendfix`.

## Step 3 — Run the Neon SQL migration ONCE

In the **Neon SQL Editor**, select the appropriate project/database/branch. First inspect and take a backup/restore point appropriate to your environment. Open `migrations/20261123_013_admin_management.sql`, copy all SQL, execute it and verify no errors.

This creates **only**:
- `public.admin_action_audit` — who changed user status, issued reset links, or removed empty cases, with reason and timestamp.
- `public.admin_password_resets` — expiring, hashed password-reset tokens.

It does **not** alter existing clinical tables or data. Execute only against a database with all prior project migrations (especially `doctor_invitations`, `staff_profiles`, `patient_profiles`, and `stay_doctor_assignments`) already applied.

Verification SQL:

```sql
SELECT to_regclass('public.admin_action_audit') AS audit_table,
       to_regclass('public.admin_password_resets') AS reset_table;
```

Both should return table names.

## Step 4 — Backend local test

Environment: your existing database variables, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS`, and the existing Brevo mail settings (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`) must be set correctly. Never commit `.env` or API keys.

```powershell
cd backend
npm ci
npm test
npm start
```

From another shell check `http://localhost:5000/api/health`. Use a *test/admin account* and *test data* to verify management endpoints. Admin management requires a valid active ADMIN bearer token. The reset validation and completion endpoints are public and require a secret token.

**New endpoints**:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/management/invitations` | List invitation attempts and acceptance timestamps |
| GET | `/api/admin/management/users` | Staff/patient directory |
| PATCH | `/api/admin/management/users/:id/status` | `{ "is_active": false, "reason": "..." }` |
| POST | `/api/admin/management/users/:id/password-reset` | Request a reset email for accepted active staff |
| GET | `/api/admin/management/operations` | Read-only cases and ER stays summary |
| DELETE | `/api/admin/management/cases/:id` | `{ "reason": "..." }`; only empty unlinked `PRE_ER` placeholders |
| POST | `/api/auth/password-reset/validate-reset` | `{ "token": "..." }` |
| POST | `/api/auth/password-reset/complete-reset` | `{ "token": "...", "password": "..." }` |

Existing `/api/doctors/:user_id/resend-invitation`, `/api/staff/:user_id/resend-invitation`, and doctor/staff DELETE routes are reused unchanged.

## Step 5 — Frontend local test

Make sure the frontend uses the **real backend**; the original example defaults to mock mode.

In `frontend/.env.local` (not committed):

```dotenv
VITE_USE_MOCK=false
# For local dev with Vite proxy, leave VITE_API_BASE absent.
# VITE_API_URL=http://localhost:5000
```

Check `frontend/vite.config.ts` for the exact local proxy target if required. Then:

```powershell
cd frontend
npm ci
npm run build
npm run lint
npm run dev
```

Sign in as ADMIN and visit `/admin`, `/admin/invitations`, `/admin/users`, `/admin/operations`. Also visit on a mobile viewport.

**Test checklist** (use test accounts; avoid destructive tests against actual patients):
1. Inviting a doctor, ER staff and paramedic still works; invitation link is sent to the intended address.
2. Invitation history shows all three roles and accurate created/accepted/expiry status. Resending invalidates older pending links and sends a new one.
3. Never-accepted staff/doctor deletion works; accepted account deletion is refused.
4. User directory filters by doctor/ER staff/paramedic; deactivate an expendable TEST user and verify that their existing JWT is rejected and they cannot log in; reactivate them with a reason.
5. Password reset mail goes to the **specific user's email**, not a fixed testing recipient. Link expires after 30 minutes and cannot be used twice. Confirm login with the new password.
6. Cases show correct paramedic and status; ER stays show assigned doctor. Confirm an open case or stay is **not** deletable.
7. Create a brand-new empty PRE_ER **test** placeholder and verify deleting it requires a reason, `DELETE` confirmation and leaves an audit row.
8. Verify DOCTOR, ER_STAFF, PARAMEDIC, PATIENT views still work as before. The admin no longer has paramedic/ER-staff page navigation.
9. Verify existing backend tests and frontend build. Verify a non-ADMIN token receives HTTP 403 for all admin management endpoints.

**Important limitations**: This patch has been checked for JS/JSX syntax but **has not been run end-to-end against your actual Neon database, Brevo mail account, Render backend, or existing frontend dependencies**. The app code and prior migrations must match the current GitHub `main` inspected when this ZIP was created. Initial SQL errors or API errors must be fixed in `frontendfix` before any production rollout. The operations dashboard caps each list at 300; it shows recent eligible rows, **not an uncapped global census**. The invitation time is the database creation time, not a verified email-delivery timestamp. Previously issued JWTs may remain valid until their normal two-hour expiration after a password change; deactivation takes effect immediately via the existing middleware.

## Step 6 — Deployment without premature main merge

**Recommended**: deploy the backend from a **staging Render service** tracking `frontendfix`, with a *staging Neon branch* and test Brevo sender, then deploy the frontend preview pointed at that backend. This lets you test both halves together before merging.

If your only existing Render service watches `main`, **you cannot validate the new endpoints there until the backend containing `adminManagement.js` is deployed**. Do **not** merge the backend into `main` just to test it with an untested UI. Prefer a separate Render staging service or temporarily configure that service's branch/deploy source only after understanding the production impact. Running migrations on the production Neon database before code rollout is backward-compatible but still requires a backup and confirmation.

Once checks pass:

```powershell
git status --short
git add backend/server.js backend/routes/adminManagement.js frontend/src/App.jsx frontend/src/auth/roles.js frontend/src/components/AppShell.jsx frontend/src/api/admin.js frontend/src/pages/AdminShared.jsx frontend/src/pages/AdminInvitations.jsx frontend/src/pages/AdminUsers.jsx frontend/src/pages/AdminOperations.jsx frontend/src/pages/AdminResetPassword.jsx migrations/20261123_013_admin_management.sql INSTRUCTIONS/README_ADMIN_FRONTENDFIX.md
git commit -m "feat(admin): dedicated invitations users and operations dashboard"
git push -u origin frontendfix
```

**Only do those commit/push commands yourself when satisfied.** Open a pull request `frontendfix` → `main`, review CI and staging behavior, merge once everything works, then deploy production in a controlled order (SQL, backend, frontend). Keep rollback instructions for the Render deploy. Do not undo the migration if audit or reset records already exist without reviewing data retention needs.

## Suggested next iteration

- Admin audit-log viewer with pagination; currently audit rows are stored but not exposed in UI.
- Case correction/void workflow for *clinically populated* false cases with authorization and audit (do not hard-delete).
- True paginated ER census with filters by shift, clinician, severity, and operational status.
- Password reset initiated by staff themselves and a token/session invalidation model for password changes.
- Role-specific, append-only access reviews and admin activity dashboards.
