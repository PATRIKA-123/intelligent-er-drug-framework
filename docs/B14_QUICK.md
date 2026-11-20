B14 quick patch. Uses the existing conflict/missing mapping blockers.

From backend PowerShell:
  node --test .\test-b14-quick.js .\test-b13-b14-offline.js
  node ..\scripts\b14-patch-normalizer.js --check
  $env:PRE_ER_TEST_ENV_FILE = '.env.pre-er-test'
  $env:B14_CONFIRM_LOCAL_TEST = 'intelligent_er_drug_test'
  node ..\scripts\b14-local-migrate.js --verify
  node ..\scripts\b14-local-migrate.js --apply
  node ..\scripts\b14-local-migrate.js --verify
  node ..\scripts\b14-patch-normalizer.js --apply
  node --check .\services\medicationNormalizationService.js
  node --test .\test-b14-quick.js .\test-b13-b14-offline.js

Scope: new mapping_version columns, mapped-name integrity constraints NOT VALID (protect new changes, not historic corrections), actual version and created_at in mapping_sources. Existing rows retain version NULL = LEGACY_UNVERSIONED. Full DB integrity validation and integration tests deferred. No B10/B13 reruns.
