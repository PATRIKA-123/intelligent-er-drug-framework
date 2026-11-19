# Master Audit batch B15–B18 (offline implementation)

Based on latest reviewed `main` at 2026-11-19.

## B15
- Existing IP-wide 20/15-min request limiter remains.
- Added secondary IP+normalized-username in-process limiter (10/15-min) with HMAC keys and bounded memory. Login checks reject malformed strings; inactive accounts use generic invalid-credential response. New accounts still require 12–128 chars.
- Important release limitation: in-process counters are NOT shared across Render instances/restarts. Patrika must enable an edge/shared rate limiter before claiming horizontally scaled protection. Password-reset workflow is not implemented; do not assert it is done.
- Login and invitation tests against isolated staging DB remain pending.

## B16
Existing origin allowlist, anti-sniff/frame headers, 128 KB JSON and dev/production policies retained; no replacement code necessary. Verify Render proxy/CORS configuration in staging.

## B17
Added read-only CSV data-quality report. It flags extreme values for review, preserves raw values, and explicitly labels timestamps as de-identified/date-shifted. It does not persist patient data or quarantine real observations. Patrika must review source provenance and implement durable data-quality status/migration.

## B18
Existing startup config validation, environment precedence and backend/.env.example retained; no replacement code necessary. Never commit any `.env` file.

## Commands from repo root
```
node --test backend/test-b15-b18-offline.js
node backend/test-rate-limit.js
node --test backend/test-http-security.js backend/test-startup-environment.js
node scripts/dataQualityReport.js
node --check backend/routes/auth.js
node --check backend/middleware/authThrottle.js
node --check scripts/dataQualityReport.js
git diff --check
```

Never run DB-changing tests against deployed Neon production.
