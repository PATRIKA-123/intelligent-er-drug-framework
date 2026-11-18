# Parvah backend audit — drop-in ZIP, Batch 01

**Source baseline:** GitHub `PATRIKA-123/intelligent-er-drug-framework`, `main` inspected on 2026-11-18, latest `695fe751080e`.
**Master Audit coverage:** B01 — focused Post-ER prescription data exposure only. This is NOT closure of all of B01 or the 26-finding audit.

## Installation on Windows / VS Code

1. Make sure you are on `fix/audit1` and have saved your work. Run `git status` first. If the affected file already has uncommitted changes, do not overwrite it.
2. Make a backup of `backend/services/postErService.js` outside the project, or commit any intended pending changes.
3. Open this ZIP and copy its contents DIRECTLY into your existing **backend/** folder, preserving the `services/` directory. Allow replacing only `services/postErService.js`. The test and checklist are new files.
4. In the VS Code terminal, from the repository root:

```powershell
node --check backend/services/postErService.js
node --test backend/test-post-er-prescription-privacy.js
git diff -- backend/services/postErService.js
```

5. Expect **5 focused tests to pass**. They are database-free mock tests; also perform a safe integration check against an isolated test database and test users before approval.
6. Review the diff, then commit to `fix/audit1` only after passing tests. Do NOT directly edit `main` or deploy to production.

## Change explanation

- `services/postErService.js`: receives the authenticated caller role, rejects missing/invalid roles instead of silently falling back to staff access, and passes `role` to `getPrescriptions`.
- `test-post-er-prescription-privacy.js`: regression tests for PATIENT, DOCTOR, absent role, authorized-only SQL selection, and an old-schema fail-closed case.
- `MASTER_AUDIT_CHECKLIST.md`: B01–B26 tracker based on the original master PDF; status flags are conservative and no claim of verified closure is made.

**Important:** This patch does not change `prescriptionService.js`. It relies on the current `main` implementation of `getPrescriptions(stayId, { role })`, which filters PATIENT records to `AUTHORIZED` and omits staff review data. Do not apply to an older version of the repository without reviewing that dependency.

**Verification limitations:** Five tests ran successfully in an offline isolated harness with a snapshot of the latest behavior. No real Neon database, Render deployment, full backend test suite, clinical certification, or live patient data were used.

**Concurrent work:** If Patrika updates `postErService.js` after this source baseline, compare and merge changes rather than unconditionally overwriting newer work.
