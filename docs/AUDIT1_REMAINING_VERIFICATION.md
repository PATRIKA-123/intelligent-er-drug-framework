# Audit 1 ordered verification — B04, B09, B17, B10

Scripts here are inspection-only and never touch the old historical B10 backfill. **Do not stage any environment files or source dumps.** The scripts intentionally cannot claim DB verification without local output.

## B04 — genuinely fresh rebuild on an empty disposable database

The existing project already contains `scripts/b04-bootstrap-test-db.js`. It **rejects nonempty databases**. Do not run it on `intelligent_er_drug_test` (the populated 554-row DB).

1. In a PowerShell session at repository root, copy `backend/.env.pre-er-test` to a distinct gitignored local file `backend/.env.audit1-rebuild` and edit **both** `DB_NAME` and `PRE_ER_TEST_DATABASE_NAME` to `intelligent_er_rebuild_test`. Ensure `DB_HOST=localhost` and `DB_SSL=false`.
2. Create the brand-new *empty* `intelligent_er_rebuild_test` DB via PostgreSQL administrator (`createdb`) locally. Do NOT drop any existing DB; if it exists, stop and choose another name.
3. Run (from repo root):

```powershell
$env:PRE_ER_TEST_ENV_FILE = "backend/.env.audit1-rebuild"
$env:B04_ALLOW_DISPOSABLE_BOOTSTRAP = "YES"
$env:PSQL_PATH = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
node scripts/b04-bootstrap-test-db.js --apply
node scripts/audit1-batch10-local.js
node scripts/audit1-batch10-local.js --apply --confirm-disposable
node scripts/audit1-batch10-local.js
```

Expected: bootstrap works on an empty DB, all 3 migrations become `ALREADY_RECORDED` with checksums. For meaningful B04 reproducibility, also run existing offline tests and a **DB integration test against this disposable rebuild**, then record outputs. Baseline file `schema-export.sql` must exist. Importing clinical data is a separate test; schema-only rebuild does not mean data was restored.

## B09 and B17 — compare the cleaned CSV to official upstream, no database writes

PhysioNet **MIMIC-IV-ED Demo 2.2** file: `https://physionet.org/files/mimic-iv-ed-demo/2.2/ed/vitalsign.csv.gz`.

```powershell
New-Item -ItemType Directory -Force .\local-source-verification | Out-Null
Invoke-WebRequest -Uri "https://physionet.org/files/mimic-iv-ed-demo/2.2/ed/vitalsign.csv.gz" -OutFile ".\local-source-verification\vitalsign.csv.gz"
node --test scripts/audit1-verify-source-vitals.test.js
node scripts/audit1-verify-source-vitals.js data/cleaned_vitals.csv local-source-verification/vitalsign.csv.gz
```

Expected 554 exact source matches (subject, stay, charttime and five vitals). Source contains SBP **11** and DBP **184** for subject `10020740`, stay `38233644`, time `2151-01-25 19:18:00`; **do not auto-correct**. Confirm source metadata and SHA256 as needed.

MIMIC official documentation explicitly says ED temperature field is Fahrenheit, but some entries were *incorrectly documented as Celsius*: `https://mimic.mit.edu/docs/iv/modules/ed/vitalsign.html`. There is **no per-row unit field** in original `vitalsign.csv.gz`. Comparing all 554 values can verify original **numerical provenance**, but cannot establish each record's *actual measurement unit*. Keep 34 Celsius-like entries `UNVERIFIED_CELSIUS` pending definitive provenance; do not treat as verified NEWS2 inputs.

## B10 — final read-only DB and API checks

**Never repeat** completed `backfillAssumedInputs.js --apply`.

```powershell
cd backend
$env:PRE_ER_TEST_ENV_FILE = ".env.pre-er-test"
node --test .\test-news2-unknown-inputs.js
node ..\scripts\audit1-b10-readonly-verification.js
```

Existing `backend/test-assumed-inputs-api-db.js` exercises real routes, but it **creates and drops a test schema `acl_api`**, so run it **only against a separate disposable local test database** after assessing its code, not against shared databases. Example on the fresh isolated B04 rebuild: `node backend/test-assumed-inputs-api-db.js` from repo root with appropriate environment.

Known distinction from source inspection: `inputProvenance.js` returns a tri-state summary (`true` assumed / `false` all confirmed / `null` provenance unknown), and the stays route returns the individual flags. But **`news2_results_real` is not proven to persist a per-run provenance snapshot**, and `clinicalAudit.js` logs access metadata to console without persisting clinical input provenance. The prior NEWS2 results may have been computed with the old invented defaults. This must be addressed before saying B10 final is complete.

## B13/B14/B22 sequencing

After B04/B09/B17 and B10 pass their evidence gates, implement durable `screening_runs`, medication mapping source/version constraints, immutable result history and concurrency tests. Existing B13/B14/B22 code already provides snapshot statuses, duplicate mapping detection and transaction scoped serialization. Avoid overwriting those without inspecting current `fix/audit1` branch.
