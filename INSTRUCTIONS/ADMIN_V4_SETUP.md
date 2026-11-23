# Parvah Admin V4 — existing `frontendfix` branch

## Scope and safety

This ZIP is **source code**, not an update to Neon or Render. Extract from the repository root on `frontendfix`. It does not commit or push anything.

- **Accounts**: `Remove access / archive` works for doctor, paramedic, ER staff, patient, and other administrator accounts. It immediately disables authentication (including archived checks in auth middleware), replaces the password hash, revokes unused staff invitations and password-reset tokens, and hides the account from the normal admin directory. **It is archival, NOT physical erasure**: database user row and clinically referenced prescriptions, doctor assignments, cases and medical history remain. Cannot archive your own account or the last active administrator. V3's verified-test purge still permanently deletes eligible unreferenced staff accounts.
- **Incoming ER**: ER staff can read PRE_ER workflow and vital-sign records for a case ID, without being granted paramedic write permissions. Other case statuses continue through the original access policy. The temporary read-only PRE_ER summary intentionally does not invent a NEWS2 score; clinical scoring must be reviewed via the clinician workflow.
- **Patient visit claim**: for an unclaimed visit, a valid active one-time staff-issued code plus the hospital-recorded phone's last four digits immediately links it to the logged-in patient, consumes the code, rate-limits failed attempts and writes a patient identity audit event. A visit already owned by someone else still cannot be claimed; conflicting ownership requires staff resolution. The patient's sharing consent is unchanged.
- **Forms**: patient signup and new ER registration require name, DOB, phone and email, with corresponding server validation. The add-visit fields are required. Do not fabricate or guess vital measurements: existing partial-vital entry remains possible in emergencies. Doctor assignment can be recorded later.

## Step 1: Back up

- Create a Neon restore point / recovery branch for `pravah2` before changing production code, especially if testing patient linking or account archival.
- Keep previous V3 ZIP, and be sure `git status` contains no unexplained working changes.

## Step 2: Extract at repository root

```powershell
git branch --show-current  # must say frontendfix
Expand-Archive -Path "$env:USERPROFILE\Downloads\parvah_admin_v4_frontendfix.zip" -DestinationPath . -Force
git status --short
```

## Step 3: Neon SQL Editor (no local database)

Open the existing Neon project, **database pravah2**, and run ONLY the new file:

`migrations/20261123_014_archived_user_accounts.sql`

It adds a nullable `public.users.archived_at` column and index. It does not change the existing clinical data or delete users.

Verify:

```sql
SELECT column_name,data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='users' AND column_name='archived_at';
```

## Step 4: Test syntax / frontend

```powershell
cd frontend
npm ci
npm run build
npm run lint
npm run dev
```

`frontend/.env.local` should use the **existing** Render service (not another service):

```dotenv
VITE_USE_MOCK=false
VITE_API_BASE=https://intelligent-er-drug-framework.onrender.com
```

Restart Vite after changing env. Do not publish the frontend until the matching backend is deployed.

## Step 5: Existing Render backend

Render pulls Git commits, not uncommitted local files. When ready, from the repository root on `frontendfix`:

```powershell
git add backend frontend migrations/20261123_014_archived_user_accounts.sql INSTRUCTIONS/ADMIN_V4_SETUP.md
git commit -m "fix: incoming ER access, patient claims and admin account archival"
git push -u origin frontendfix
```

In your **existing Render service**, temporarily select `frontendfix` as the deployment branch if that service currently targets `main`. Deploy the branch; leave `main` unmerged until tested. Understand that changing the branch of your existing service changes the live backend. Keep the previous successful deployment readily available to roll back.

Do NOT change Neon connection settings, email settings or credentials unnecessarily.

## Step 6: Exact smoke tests

1. Log in as ER staff; enter an existing **PRE_ER** paramedic case ID in Incoming. The case should load without 403, even before handover completion; read-only handover details should appear. Test that ER staff still cannot write paramedic assessments.
2. Link a disposable test case to an ER visit using existing ER registration. Make sure no duplicate visit was created.
3. With a disposable test patient account and a new unclaimed test visit, enter the visit ID, one-time code and matching phone last4. The visit should show immediately in `/patient`, without `PENDING_VERIFICATION`. A second account must not be able to claim the same visit.
4. Confirm existing patient history sharing consent remains unchanged, and wrong codes trigger rate limits.
5. In Admin → Users, archive a disposable unlinked account. Verify login becomes impossible, account disappears from directory, and the audit log contains `ACCOUNT_ARCHIVED`.
6. On a doctor with an ACTIVE assignment, archiving must return 409 until all active patients have been properly reassigned. Prescriptions and historical assignments remain preserved. Do not test this with a live clinician.
7. Verify an admin cannot archive their own account; keep another active administrator before testing admin-account archival.
8. Verify existing V3 permanent-cleanup preview continues to work only for its eligible staff records.
9. Test patient registration and ER visit registration require email/phone and other demographics. In real emergency care, staff should not invent measurements or contact details to bypass validation; report any workflow that blocks urgent treatment.

## Existing pending patient identity claims

Claims already submitted under the previous flow remain pending. The new endpoint resolves a matching pending claim only if that patient submits a still-valid unused code. If a code has expired or been revoked, issue a fresh one from the ER.

## Known limitations

- Account archival retains the `users` row for foreign-key and clinical audit history; it is not GDPR-style physical erasure. For complete physical removal of patient/admin entities plus historical clinical records, a separate retention/consent/referential-integrity design is required.
- The incoming PRE_ER read-only fallback returns raw vital data but does not calculate a NEWS2 score. Do not treat missing NEWS2 output as low risk.
- This ZIP does not rewrite every existing form in the repository. It updates patient registration, ER registration, visit claiming and the admin removal form. Existing clinical forms continue to allow unmeasurable values to be documented as missing. Review remaining forms individually before imposing hard clinical requirements.
- Static JS/JSX syntax was checked; running against your exact Neon database and Render deployment has NOT been performed here.
