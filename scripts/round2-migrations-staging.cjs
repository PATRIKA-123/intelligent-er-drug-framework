'use strict';
// Staging migration inspection; deliberately NO permanent apply mode.
// Run from repository root. Never connect to a production or remote DB.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const repo = process.cwd();
const EXPECTED_DB = 'intelligent_er_drug_test';
const FILES = [
  '20261120_009_doctor_reassignment.sql',
  '20261120_010_patients_visits.sql',
  '20261120_011_round2_er_post_er.sql',
  '20261120_012_patient_portal_identity.sql',
];
function guards(env) {
  if (env.ROUND2_STAGING_READONLY !== 'YES' || env.ROUND2_STAGING_DB_NAME !== EXPECTED_DB)
    throw new Error('Explicit staging guard missing; require ROUND2_STAGING_READONLY=YES and ROUND2_STAGING_DB_NAME=intelligent_er_drug_test');
  if (env.DATABASE_URL || env.PGHOST || env.PGDATABASE || env.PGSSLMODE)
    throw new Error('DATABASE_URL/PG* override present; refuse ambiguous connection');
  if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST))
    throw new Error('Only local PostgreSQL DB_HOST is accepted');
  if (env.DB_NAME !== EXPECTED_DB) throw new Error('DB_NAME must be intelligent_er_drug_test');
  if (env.NODE_ENV === 'production' || String(env.DB_SSL).toLowerCase() === 'true')
    throw new Error('Production/SSL configuration refused');
  if (typeof env.DB_PASSWORD !== 'string') throw new Error('DB_PASSWORD must be provided by local test environment');
}
function readMigrations(directory) {
  const sql = FILES.map(name => {
    const value = fs.readFileSync(path.join(directory, name), 'utf8');
    if (!value.trim() || /\\copy\b|\bDROP\s+TABLE\b|\bTRUNCATE\b/i.test(value)) throw new Error(`Unexpected SQL in ${name}`);
    return { name, sql: value };
  });
  return sql;
}
async function inspect(client) {
  const info = (await client.query(`SELECT current_database() AS db, current_user AS db_user, inet_server_addr()::text AS server_addr, current_setting('transaction_read_only') AS read_only`)).rows[0];
  if (info.db !== EXPECTED_DB || info.read_only !== 'on') throw new Error('Database/transaction guard mismatch');
  // A localhost TCP endpoint may be forwarded to PostgreSQL in Docker/WSL;
  // inet_server_addr() is the server-side socket address, not the client target.
  // Security remains enforced by the explicit local DB_HOST allowlist, DB name,
  // refusal of remote URLs/PG overrides, and post-connect current_database().
  const deps = await client.query(`SELECT to_regclass('public.users') IS NOT NULL AS users, to_regclass('public.patients') IS NOT NULL AS patients, to_regclass('public.ed_stays') IS NOT NULL AS ed_stays, to_regclass('public.stay_doctor_assignments') IS NOT NULL AS doctor_assignments, to_regclass('public.discharges') IS NOT NULL AS discharges`);
  if (Object.values(deps.rows[0]).some(x => x !== true)) throw new Error('Required base schema tables are missing');
  const duplicates = await client.query(`SELECT COUNT(*)::int AS duplicate_stays FROM (SELECT stay_id FROM public.stay_doctor_assignments WHERE status='ACTIVE' GROUP BY stay_id HAVING COUNT(*)>1) q`);
  const legacy = await client.query(`SELECT COUNT(*)::int AS discharged_stays FROM public.ed_stays s WHERE EXISTS (SELECT 1 FROM public.discharges d WHERE d.stay_id=s.stay_id)`);
  const idMax = await client.query(`SELECT (SELECT MAX(subject_id) FROM public.patients)::text AS max_subject_id, (SELECT MAX(stay_id) FROM public.ed_stays)::text AS max_stay_id`);
  const catalog = await client.query(`SELECT to_regclass('public.patient_profiles') IS NOT NULL AS patient_profiles_exists, to_regclass('public.er_vital_entries') IS NOT NULL AS er_vitals_exists, to_regclass('public.visit_access_codes') IS NOT NULL AS access_codes_exists, EXISTS(SELECT 1 FROM pg_constraint WHERE conname='round2_visit_status_check' AND conrelid='public.ed_stays'::regclass) AS visit_status_constraint_exists`);
  return {database: info.db, db_user:info.db_user, read_only:info.read_only, duplicate_active_doctor_stays:duplicates.rows[0].duplicate_stays, legacy_discharged_stays_affected_by_011:legacy.rows[0].discharged_stays, ...idMax.rows[0], ...catalog.rows[0]};
}
async function main() {
  if (!['--preflight','--dry-run'].includes(process.argv[2]) || process.argv.length !== 3) {
    throw new Error('Usage: node scripts/round2-migrations-staging.cjs --preflight OR --dry-run (never applies permanently)');
  }
  // Use explicit file path; unlike node -e this works in PowerShell.
  const dotEnvPath=path.resolve(repo,'backend/.env.pre-er-test');
  if (!fs.existsSync(dotEnvPath)) throw new Error('Missing backend/.env.pre-er-test');
  const dotenv=require(path.resolve(repo,'backend/node_modules/dotenv'));
  // Never inherit any old DB vars: require caller to unset DATABASE_URL and PG* overrides.
  const config=dotenv.parse(fs.readFileSync(dotEnvPath));
  const env={...process.env, ...config};
  guards(env);
  const pg=require(path.resolve(repo,'backend/node_modules/pg'));
  const pool=new pg.Pool({host:env.DB_HOST,port:Number(env.DB_PORT||5432),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,ssl:false,connectionTimeoutMillis:5000,max:1});
  let client;
  try {
    client=await pool.connect();
    await client.query('BEGIN READ ONLY');
    const summary=await inspect(client);
    await client.query('ROLLBACK');
    console.log('ROUND2_MIGRATION_PREFLIGHT',JSON.stringify(summary,null,2));
    if(summary.duplicate_active_doctor_stays>0) throw new Error('STOP: duplicate active doctor assignments must be investigated before migration 009');
    if(summary.patient_profiles_exists||summary.er_vitals_exists||summary.access_codes_exists||summary.visit_status_constraint_exists)
      throw new Error('STOP: partial or previously applied migration detected; reconcile schema before rerun');
    if(summary.max_subject_id !== null && BigInt(summary.max_subject_id)>=9000000000n) throw new Error('STOP: patient subject sequence START conflicts with existing IDs');
    if(summary.max_stay_id !== null && BigInt(summary.max_stay_id)>=90000001n) throw new Error('STOP: stay sequence START conflicts with existing IDs');
    if(process.argv[2]==='--preflight') {console.log('ROUND2_MIGRATION_PREFLIGHT_OK; no SQL changes made'); return;}
    const migrations=readMigrations(path.resolve(repo,'migrations'));
    // In one transaction, with no commit. Files 010-012 contain BEGIN/COMMIT;
    // strip ONLY exact standalone transaction statements after checking expected layout.
    for (const m of migrations) {
      if (!m.name.includes('_009_')) {
        if (!/^BEGIN;\s*$/m.test(m.sql) || !/^COMMIT;\s*$/m.test(m.sql)) throw new Error('Unexpected transaction wrappers: '+m.name);
      }
    }
    // Session-level safeguard: postgres rolls back all statements after we issue ROLLBACK.
    // Strip internal COMMIT/BEGIN before executing to prevent accidental commits.
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    let last = '';
    try {
      for(const m of migrations){
        const source=m.sql.replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'');
        if(/\bCOMMIT\b|\bROLLBACK\b|\bEND\s*;/i.test(source.replace(/--[^\n]*/g,''))) throw new Error('Unsafe transaction token in '+m.name);
        console.log('DRY_RUN_START',m.name);
        await client.query(source);
        last=m.name;
        console.log('DRY_RUN_SQL_OK',m.name);
      }
      console.log('ROUND2_MIGRATION_DRY_RUN_PASSED; all changes will be rolled back');
    } finally {
      await client.query('ROLLBACK');
      console.log('ROUND2_MIGRATION_ROLLBACK_COMPLETE; no migration committed');
    }
  } finally {if(client)client.release();await pool.end()}
}
if(require.main===module)main().catch(e=>{console.error('ROUND2_MIGRATION_CHECK_BLOCKED:',e.message);process.exitCode=1});
module.exports={guards,readMigrations,EXPECTED_DB};
