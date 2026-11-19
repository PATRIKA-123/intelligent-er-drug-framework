# B10 — durable NEWS2 input provenance (local test only)

## Exact scope
- Does **not** repeat the completed 554-row assumption-flag backfill.
- Existing NEWS2 rows receive a separate immutable *historically derived* provenance record using current observation flags. These do NOT claim original calculation-time capture.
- New NEWS2 insertions capture three assumption flags and three missing-input flags at INSERT time.
- Append-only audit events record reconstructed data, new captures and subsequent input/result mutations (database trigger enforced for ordinary roles; database superusers remain capable of bypassing it).
- `/api/stays/:stay_id/news2` returns individual assumption flags, `based_on_assumed_inputs` (true/false/null), `based_on_missing_inputs`, and `input_provenance_origin`. Observations API already returns three flags.
- Does not change clinical measurements, NEWS2 scores or existing B10 assumption flags.

## Install
Extract the ZIP into repo root, preserving directories. Migration adds tables/triggers; script patches the existing route in a narrowly scoped, idempotent manner. **Do not use on Neon or production**.

From repository `backend`:

```powershell
$env:PRE_ER_TEST_ENV_FILE = ".env.pre-er-test"
node --test .\test-b10-provenance-offline.js .\test-b10-api-patch.js
$env:B10_CONFIRM_LOCAL_TEST = "intelligent_er_drug_test"
node ..\scripts\b10-provenance-local.js --apply
node ..\scripts\b10-provenance-local.js --verify
node ..\scripts\b10-patch-news2-api.js
node --check .\routes\stays.js
```

Restart the backend to clear `schemaCapabilities` cache after migration. Do not commit `.env` or database inventory output.

## Evidence to collect
- Migration output + `--verify` with expected total/snapshot count 554 and audited count >=554.
- Existing API DB regression: `node test-assumed-inputs-api-db.js` (uses *isolated scratch schema* and will drop schema `acl_api`; ensure only disposable local database).
- API response for an authorized stay should show all three assumption flags, `based_on_assumed_inputs:true`, `based_on_missing_inputs:false`, `input_provenance_origin:HISTORICAL_DERIVED`.
- New-insert trigger requires transactional live test to claim full correctness; current offline tests alone are insufficient.
- After these, read-only test should show snapshot provenance exists; if its older verification script only checks a column on the NEWS2 table, update its check to recognize `news2_input_provenance` rather than falsely concluding no snapshot.

## Known limits
- Migration will fail closed on duplicate NEWS2 observation IDs or missing/contradictory observation links.
- Legacy reconstruction cannot verify historical measurement-time truth. Separate historical provenance from real-time capture.
- Audit events are minimal technical provenance, not yet a complete B26 actor-authenticated, tamper-evident clinical access audit.
- B04 automated rebuild is verified for the previous 3 forward migrations; integrate this migration into future rebuild-coverage before deployment.
- Local test execution is mandatory before marking B10 closed.
