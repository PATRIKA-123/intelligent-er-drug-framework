B14 migration runner localhost endpoint check correction.
Extract to repository root, replacing scripts/b14-local-migrate.js.
Run from backend:

  node --test .\test-b14-endpoint-fix.js
  node ..\scripts\b14-local-migrate.js --verify

If verification reports PENDING, and only if the named local DB is authorized:

  node ..\scripts\b14-local-migrate.js --apply
  node ..\scripts\b14-local-migrate.js --verify

The correction does not change the B14 migration SQL, existing data, or the normalizer patch.
