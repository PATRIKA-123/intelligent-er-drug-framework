# Audit 1 — B23–B26 implementation and handoff

## B23 — offline test command and CI
- `cd backend && npm test` runs a curated 23-script offline set with a failing exit code when any script fails.
- GitHub Actions runs this same command for pull requests and pushes to main.
- **Open / Patrika:** create disposable PostgreSQL database and fixtures, then a guarded `npm run test:integration` workflow; never test against production Neon. A script count is not an assertion count.

## B24 — repository hygiene
- Runtime route mounting verified through `backend/server.js`: the live auth route is `routes/auth.js`.
- **Open:** remove `routes/auth.before-registration-fix.js` ONLY after confirming no references outside runtime; audit arbitrary helper scripts and debug logging, run an approved secret scanner, and review the unusual archived artifact. Do not automatically delete forensic material.
- Do not commit `.env`, database dumps, invitation tokens, or patient data. The `.gitignore` remains in place.

## B25 — trend classifier status
- `trendCalculator.js` calculates deltas and rates but deliberately reports `NOT_CLASSIFIED` because validated clinical thresholds have not been configured.
- `candidateTrendClassifier.js` reports data completeness and `REQUIRES_VALIDATED_RULES`; it does NOT issue deterioration labels.
- Added regression tests so nonvalidated clinical classifications are never invented.
- **Open:** verify UI/endpoint messaging clearly labels `NOT_CLASSIFIED` as unavailable (not STABLE), and obtain clinical rule approval before implementing classification.

## B26 — access audit (partial)
- Minimal structured `clinical_api_access` event logs on protected route families. Only actor ID/role, resource TYPE, method, status and outcome, UUID and timestamp are logged. Sensitive URL, query, token, payload and patient identifiers are omitted.
- This is a **best-effort application log**, not a durable audit system. Browser and API authentication protections remain unchanged.
- **Open / Patrika:** use a persistent append-only role-restricted audit table or authorized collector, define retention and access policies, correlate exact object IDs securely server-side, add all mutations and processing results, and verify denied/successful trails under test database. Make external log failure behavior an explicit risk decision.

## Command
```
cd backend
npm test
```

## Acceptance / cautions
- Review server middleware ordering and ensure required Render log retention, monitoring, and access controls are approved.
- Test against a staging deployment before releasing. Passing offline checks is not production acceptance.
