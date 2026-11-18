# Master Backend Audit: B01–B26 working checklist

Source: `Intelligent_ER_Master_Backend_Audit_Patrika.pdf` (26 consolidated findings).
This tracker distinguishes code changes from verified fixes. A checked entry is NEVER implied by a commit alone.

| ID | Severity | Original issue | Current work queue |
|---|---|---|---|
| B01 | Critical | Unscoped access to patient / stay / case records | Batch 01: **partial patch**; requires role-specific integration tests |
| B02 | Critical | Decision-support POST allows any authenticated role | Unverified / separate review required |
| B03 | Critical | Deactivated or demoted users retain stale JWT privileges | Unverified / separate review required |
| B04 | Critical | Repository schema cannot recreate the backend database | Unverified / separate review required |
| B05 | High | NEWS2 Scale 2 fractional saturation gaps | Unverified / separate review required |
| B06 | High | Existing NEWS2 tests contradict code | Unverified / separate review required |
| B07 | High | CSV dependency missing from installation manifest | Unverified / separate review required |
| B08 | High | Numeric CSV strings may not match integer database columns | Unverified / separate review required |
| B09 | High | Mixed apparent temperature units and missing canonical Celsius | Unverified / separate review required |
| B10 | High | Importer silently invents clinically significant inputs | Unverified / separate review required |
| B11 | High | ER arrival linking and downstream work not atomic/retry-safe | Unverified / separate review required |
| B12 | High | Case status transitions can race | Unverified / separate review required |
| B13 | High | Empty results indistinguishable from unscreened or stale results | Unverified / separate review required |
| B14 | High | Duplicate/conflicting medication mapping may be silently selected | Unverified / separate review required |
| B15 | High | Insufficient password policy and missing authentication rate limiting | Unverified / separate review required |
| B16 | Medium | Permissive CORS, request sizing and security headers | Unverified / separate review required |
| B17 | Medium | Outlier vital and de-identified date semantics | Unverified / separate review required |
| B18 | Medium | Missing startup secret validation and environment manifest | Unverified / separate review required |
| B19 | Medium | Requests lack one consistent validation/error contract | Unverified / separate review required |
| B20 | Medium | Unspecified API schemas and incomplete stay listing | Unverified / separate review required |
| B21 | Medium | Prescribing, discharge and review-state invariants need tests | Unverified / separate review required |
| B22 | Medium | Concurrent reruns can overwrite clinical result history | Unverified / separate review required |
| B23 | Medium | No single supported automated test command/isolated DB suite | Unverified / separate review required |
| B24 | Low | Legacy route, debug logging and helper scripts in runtime root | Unverified / separate review required |
| B25 | Low | Trend classification status may be incomplete | Unverified / separate review required |
| B26 | Medium | Clinical access/decision audit trail and sensitive logging not established | Unverified / separate review required |

## Conditions for marking any finding complete

1. Confirm issue still exists (or was fixed) on the current main commit.
2. Review relevant code and database schema without using identifiable patient records.
3. Apply a focused change on a separate branch.
4. Run passing positive, negative and cross-role tests as appropriate.
5. For DB-dependent findings, use an isolated throwaway database, not production Neon.
6. Record evidence, version and reviewer approval; only then mark closed.

## Batch history

- **01**: B01 / Post-ER aggregated prescriptions: role context propagated; mock regression tests added. Status: **implemented in patch, integration verification pending**.

## Important safety gates

- Do not deploy for actual clinical decisions without qualified clinical review and privacy/security acceptance.
- Do not run schema-drop integration tests or importer/backfill scripts against production Neon.
- Do not publish credentials, JWTs or patient datasets.
