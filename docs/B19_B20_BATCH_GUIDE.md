# Audit 1 — B19/B20 code batch

Source: Master Backend Audit (B19 consistent validation/error contract; B20 scoped stable pagination and OpenAPI).

## Files and behavior

- `backend/routes/stays.js` (replace): returns scoped, stable pages sorted by `intime ASC NULLS LAST, stay_id ASC`; exposes `total` and `has_more` while preserving prior `limit/offset/count/stays`. Supports optional, bounded literal `search` on chief complaint or exact stay ID. Count and rows use the same access-policy WHERE clause.
- `backend/validators/stayQuery.js` (new): strictly validates parameters. Unknown keys, negatives, decimals, arrays, and partial integer strings return 400.
- `backend/middleware/apiErrorContract.js` (new): adds stable machine-readable `code` alongside legacy `error` message, plus safe JSON parsing and body-size error handling.
- `backend/server.js` (replace): installs error normalization and error handler without removing existing security, routes or environment checks.
- `backend/test-b19-b20-offline.js` (new): 7 database-free tests including a mocked version of the actual stay route.
- `docs/openapi-stays.yaml` (new): initial OpenAPI 3.0.3 contract covering all ED stay endpoints; other project endpoints still need coverage.

## Run from repo root

```powershell
node --test backend/test-b19-b20-offline.js
node --check backend/server.js
node --check backend/routes/stays.js
node --check backend/validators/stayQuery.js
node --check backend/middleware/apiErrorContract.js
node --test backend/test-http-security.js backend/test-startup-environment.js
node backend/test-id-validator.js
git diff --check
```

## Real integration/deployment checks deferred

- Execute against isolated database with synthetic PATIENT/DOCTOR/ER_STAFF users; verify total counts are scoped and no cross-user leakage occurs.
- Verify pagination across equal/null timestamps with 100+ rows; under concurrent writes, offset paging may shift records between requests (cursor paging would provide stronger consistency).
- Verify `ILIKE ... ESCAPE` PostgreSQL query with literal `%`, `_` and backslash search strings.
- Extend OpenAPI to all other routes, including POST/PATCH request contracts and negative cases.
- Error `code` is an additive response field. Some legacy routes use non-{error} bodies; those need route-specific normalization. This ZIP does not claim every API input is now validated identically.
- Review frontend consumption of paging. Empty result page is `{count:0, stays:[]}`, which does not imply an empty entire dataset.

Do not execute database-mutating tests against the deployed production Neon database.
