# PARVAH Round 2 — Batch E: frontend ↔ backend adapter

## Installation
Extract this ZIP at the repository root without removing existing files. From PowerShell:

```powershell
node --test frontend-tests/test-round2-e.cjs
node scripts/round2-e-patch.cjs --check
node scripts/round2-e-patch.cjs --apply
cd frontend
npm ci
npm run build
npm run lint
cd ..
git diff --check
git status --short
```

Preflight halts if expected source anchors differ; no file is modified during `--check`. Re-running after `--apply` detects the marker and skips files. Inspect the diff before committing. No database migration in Batch E.

## Adapter changes
- Replaces real adapter 501 placeholders with existing Batch A–D routes.
- Uses scoped GET /api/stays list directly rather than N+1 clinical summary fetching.
- Creates ER visits with nested `patient`, `case_id`, `chiefcomplaint`, and a stable 12–128-character idempotency key across retries. `client.js` allows only this additional request header.
- Claims submit for staff identity review (HTTP 202); the patient UI no longer treats submission as completed medical access.
- Unknown prescription activity is not displayed as "active"; patient medicine pages separate unknown from active and ended.
- Existing mock-mode selector, React routes and visual design stay intact.
- Parametric health-note forms map `extra` into expected `reaction` / `dose` / `note` fields.
- Supports the existing public invite links and ER desk patient details.

## Important outstanding integration / clinical items
- Real frontend authenticated staging E2E needs isolated synthetic patients and all five roles. Test patient claim pending and admin approval, then consent withdrawal, including two-user unauthorized reads.
- Confirm the real schema and migrations 009–012 were applied **to staging only** before enabling new calls. Clinical screening policy, discharge constraints and older-visit data are not closed by frontend adapter wiring.
- Review admin identity-review UI; the adapter exposes admin `listIdentityReviews` / `reviewIdentity` but does not create a new administrator screen.
- `GET /api/patient/me` in Batch D currently omits detailed doctor/diagnosis info and returns medicine activity UNKNOWN: the UI should not synthesize either.
- Existing mock mode contains synthetic demo identity-link behavior different from real manual verification. Do not use it to validate production security.
- No source-code-backed UI acceptance is claimed until `npm run build` and role-specific staging browser tests pass on the actual branch.
