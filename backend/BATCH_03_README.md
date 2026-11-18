# Parvah backend audit — Batch 03 (B16)

## Contents and scope
This ZIP contains complete replacement copies of the files listed below, not line-by-line patches. The `backend/` prefix is intentional: extract at the **repository root** (`C:\Dev\intelligent-er-drug-framework`), or open the ZIP's `backend` folder and copy its contents directly into your existing `backend/` folder.

- `backend/server.js` — **includes Batch 02 / B18 startup validation**; adds B16 CORS allowlist, API security headers, JSON size limit, and disables Express X-Powered-By.
- `backend/config/httpSecurity.js` — new B16 origin-policy and headers helper.
- `backend/test-http-security.js` — 12 focused offline tests.
- `backend/.env.example` — includes **Batch 02/B18 variables** and B16 CORS settings; never contains real credentials.
- `backend/MASTER_AUDIT_PROGRESS_BATCH03.md` — audit status and merge gates.

**Do not extract Batch 02 again after Batch 03**: this ZIP includes an updated version of the same `server.js` and `.env.example`. It preserves the previous B18 validator call, but it cannot preserve unrelated local edits made after Batch 02; inspect `git diff` first. It does not modify `frontend/`, `backend/db.js`, `backend/config/validateEnvironment.js`, or database files.

## Required configuration
`CORS_ORIGINS` is a comma-separated list of **exact browser origins** (scheme + host + optional nondefault port; NO trailing slash or path). Examples:

- Development Vite: `http://localhost:5173` (when `NODE_ENV` is not `production`, this is allowed by default, along with `http://127.0.0.1:5173`).
- Render + deployed frontend: `CORS_ORIGINS=https://YOUR-DEPLOYED-FRONTEND.example`
- Production plus staging: `CORS_ORIGINS=https://YOUR-DEPLOYED-FRONTEND.example,https://YOUR-STAGING-FRONTEND.example`

**When `NODE_ENV=production`, `CORS_ORIGINS` is mandatory; without it the backend refuses to start.** Configure it on Render **before deployment**, using actual frontend origins. B18 still also requires JWT_SECRET (>=32 chars) and DB_* credentials in the runtime environment. Do not commit `.env` or secrets. Setting frontend `VITE_USE_MOCK=true` bypasses the API and does not test CORS.

Client access uses `Authorization: Bearer ...` and `Content-Type: application/json`. No cookie credentials are enabled. Requests with a disallowed `Origin` receive 403. Requests without any Origin are allowed through CORS filtering (they still require normal API authentication). CORS is **not** an authorization mechanism, and non-browser clients can forge Origin.

Default request limit: 128 KiB for JSON bodies. Verify existing invitation, clinical and registration payloads fit before merging; 413 may indicate you need a route-specific limit or additional design work. Browser OPTIONS preflights must succeed from *allowed* origins.

## Verification (Windows PowerShell, repository root)
```powershell
node --test backend/test-http-security.js
node --test backend/test-startup-environment.js
node --test backend/test-post-er-prescription-privacy.js
node --check backend/server.js
node --check backend/config/httpSecurity.js
git diff --check
git status
```
Expected B16 offline result: 12 pass / 0 fail. Prior batch tests should still pass.

### Before merging: local/staging HTTP integration (with safe development DB and non-production secrets)
1. Set a valid JWT_SECRET and DB_* settings in an ignored repository-root `.env`, or use environment variables. Start backend from `backend/` with `npm run dev`.
2. From PowerShell test a **permitted** preflight (no real bearer token required):
   ```powershell
   curl.exe -i -X OPTIONS "http://localhost:5000/api/auth/login" -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
   ```
   Expect HTTP 204 and `Access-Control-Allow-Origin: http://localhost:5173`.
3. Test a denied preflight with `Origin: https://not-allowed.example`; expect HTTP 403 and no `Access-Control-Allow-Origin` permitting it.
4. Test `GET /api/health` and login with synthetic credentials. Run frontend with `VITE_USE_MOCK=false`, and verify actual browser requests from localhost. Confirm browser network console shows no CORS failures for allowed origin.
5. Check representative JSON POST/PATCH endpoints including previously working workflows. Verify large JSON is rejected with HTTP 413. No PHI and no real patient cases for testing.
6. Test on a non-production Render/staging deployment with `NODE_ENV=production` and correct `CORS_ORIGINS`, including deployed frontend deep links and preflights.

## Merge plan after Batch 03
1. Confirm Batch 01/02/03 changes are committed to `fix/audit1`, `git status` is clean, and all tests listed above pass.
2. `git fetch origin` and check whether Patrika updated `origin/main`. If updated, merge/rebase carefully and rerun checks; **do not overwrite her changes**.
3. Review the pull request diff and make sure *only* intended backend files changed. Get Patrika's approval; do not merge directly into main without review.
4. Confirm Render environment values first (JWT_SECRET, DB_*, `CORS_ORIGINS`), then deploy through the agreed change process. Do not claim clinical production readiness merely because these three batches passed.

## Audit status
B16: code and focused tests implemented; staging HTTP integration pending. B18: offline validated, startup integration pending. B01: partial Post-ER correction, patient/staff integration tests pending. **Remaining Master Audit items are not covered by these batches.**
