# Parvah V5 — ER incoming access and Archive / History

This is a root-extractable patch for the existing `frontendfix` working branch. Do not merge into `main` until tested. No GitHub push is performed by the assistant.

## Install

1. Preserve local changes and confirm `git branch --show-current` reports `frontendfix`.
2. Extract this ZIP into the repository root, allowing the included relative paths to overwrite matching files.
3. Inspect `git diff` before committing. Keep your existing V1–V4 files; this ZIP includes only changed V5 files.
4. **Neon:** This patch introduces no new migration. V4's migration `20261123_014_archived_user_accounts.sql` must already have been applied successfully for archive history.
5. **Render:** Deploy the updated backend code from `frontendfix` to your existing Render service. A locally edited backend cannot affect Render until deployed. Verify the commit hash and deployment completion under Render Events/Logs.
6. Frontend: ensure `VITE_USE_MOCK=false` and `VITE_API_BASE` points to your existing Render URL; restart Vite (`npm run dev`).

## ER incoming test

- Log in as ER staff, go to `/incoming`, and find a PRE_ER case ID such as `69`.
- Frontend calls **GET `/api/er-incoming/69`** (instead of the old `GET /api/emergency-cases/69/workflow`), which requires ER_STAFF or ADMIN and is read-only.
- Confirm the new request is HTTP 200 in browser DevTools Network. If 404, check that the Render deployed code includes `backend/routes/erIncomingCase.js` and its route mount in `backend/server.js`.
- Confirm the case information appears; register an ER visit only with verified real patient details.
- Other paramedic routes and POST/PATCH authorization remain unchanged.

## Archive / History

- Sign in as admin and open `/admin/history` using the new left-rail icon or top nav.
- Tabs: Archived accounts (logically removed, no login), Closed cases (retained records), Invitations (historical accepted, revoked, expired), Data & deletion log (audit events).
- All tabs are read-only, show at most the most recent 250 records each, and never restore purged records.
- Case status `CLOSED` is **not equivalent** to archived or deleted. Permanent deletion history only survives in the audit table; the full deleted record cannot be viewed or restored.

## Diagnostic if access denied persists

1. Open browser DevTools -> Network -> Fetch/XHR, click `Find ambulance case` and inspect exact Request URL and response status.
2. It must request `/api/er-incoming/69`. If you still see `/api/emergency-cases/69/workflow`, the frontend was not updated or rebuilt.
3. `401` means authentication rejected the token; sign in again. `403` suggests role mismatch or a server version mismatch. `404` suggests the new route is not deployed or the case is absent in that DB.
4. Check Render Events for the deployed commit SHA. Do not change account roles or disable authentication to suppress the error.

## Tests

- `cd frontend && npm ci && npm run build && npm run lint`
- `cd ../backend && npm ci && npm test` (offline test suite does not require a local PostgreSQL server unless individual tests specify otherwise).
- Check all four prior admin pages, new Archive / History, ER Incoming, paramedic case ownership, and doctor/patient flows.
- Never expose API keys, login tokens, passwords, or patient-identifying information in screenshots of requests.
