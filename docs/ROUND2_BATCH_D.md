# Parvah Round 2 — Batch D: Patient portal and identity safeguards

## Scope

**Code included** (requires earlier B2 registration code/migration 010 and C migration 011):
- T18: `/api/patient/register`, `/api/patient/me`, `/api/patient/profile` and `/api/patient/password`.
- T19: Patient-owned `/api/patient/health`, `POST` and `DELETE` on `/api/patient/allergies`, `/api/patient/medications`, `/api/patient/conditions`.
- T12/T27: `/api/patient/claim-visit` validates single-use, non-expired code + full patient phone last-four, rate-limits across account/IP/stay, and creates an **identity-review request**, not immediate clinical access. `/api/stays/:stay_id/access-code` revokes old unused codes and generates a new code for ER staff/admin.
- T13/T21: `/api/stays/:stay_id/patient-history` checks role, stay access and live consent on every request, audits access and labels patient notes as unverified. If consent is off it reveals no clinical history. Current implementation returns earlier visit basics and patient-reported notes; full historical hospital fields are still pending.
- T20: ER staff/admin GET/PATCH patient details. This does not silently attach a patient account from a demographic match. Demographic edits are audited.
- T28: ADMIN `/api/admin/identity-reviews`, `/api/admin/identity-reviews/:id/decision`, `/api/admin/identity-corrections` provide an explicit, auditable manual review path.

## Apply to current auditfix2 (repository root)

1. Unzip the package at root, preserving paths. **Do not overwrite** B2/C code.
2. Run `node --test backend/test-round2-d.js`.
3. Run `node scripts/round2-d-patch.js --check` then `node scripts/round2-d-patch.js --apply`.
4. Run `node --check backend/server.js`, `node --check backend/routes/round2Patient.js`, `node --check backend/routes/round2Identity.js`, `node --check backend/services/round2Patient.js` and `node --test backend/test-round2-d.js`.
5. Run `git diff --check` and review `git status --short`. **No production deployment or merge yet.**

## Schema verification and security gate

Apply `migrations/20261120_012_patient_portal_identity.sql` only to an isolated PostgreSQL staging DB **after** migrations 009–011 have been reviewed/applied. Confirm schema-only export and table/column types first. Do not seed, reset, test email, or drop production data.

Then run **real authenticated API integration tests** using two separate synthetic patients and separate staff users: cross-user negative results for every collection and detail endpoint; concurrent same-code claims; expired/revoked/reused code; missing phone; concurrent correction review; consent withdrawal; malformed input, roles, IP/stay/account rate limits and current account deactivation. Assert no user can access a visit until an authorized manual identity decision is approved. For approved reviews use a real out-of-band identity-verification process; entering a string in `verification_method` does **not** itself prove identity. Review retention/privacy requirements for IP digest and health data. The SQL audit table is application-maintained; independent immutability/DB governance remains to be reviewed.

## Deliberate security decisions / open work

- **No automatic identity association** based on DOB and phone/email. Staff must verify and approve. Registration creates a separate patient row instead of assuming a demographic match is the same patient.
- Code + last four digits **does not** immediately reveal clinical data; it submits `PENDING_VERIFICATION` for authorized review. Patient cannot approve their own request.
- Codes are shown once at visit creation or regeneration; SHA-256 hashes are stored. A claim request binds to the original `code_id`; changing/revoking the code prevents a stale claim approval.
- No default `active:true` for prescriptions; activity is reported `UNKNOWN` unless verified.
- Patient-reported allergies/medications/conditions must **not** be interpreted as verified hospital findings. An empty list is not evidence of none.
- The implementation is **not** complete T27 recovery (lost-account/device-compromise recovery, token/session revocation, durable shared/global rate limiting) or complete T13 longitudinal hospital history. No frontend integration or clinically approved release is claimed.
- Patient self-service uses `/api/patient/*`, not broader record-level `/api/stays/*`, until those policies are reconciled with claim ownership.
- The in-memory public registration limiter is not a distributed rate limiter. Add shared/edge protection and abuse logging before internet release.

## Stage-only operational checklist

- Confirm `JWT_SECRET` strong and private; no secrets in ZIP, Git, test output, or screenshots.
- Check privacy for `claim_attempts` IP digests; decide retention window/deletion policy with a privacy reviewer.
- Require independent verification of identity **outside** a self-reported DOB, last four digits, or the code before approving staff decisions.
- Handle duplicates, declines, reassignment, explicit consent withdrawal, and audit trail; human/clinical review required.
