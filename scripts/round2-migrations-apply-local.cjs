'use strict';
// Parvah Round 2: ONE-TIME LOCAL DISPOSABLE DB schema apply. No production or remote target.
// No dependencies beyond existing backend/node_modules/{dotenv,pg}.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const EXPECTED_DB = 'intelligent_er_drug_test';
const CONFIRM = `APPLY_009_012_TO_${EXPECTED_DB}`;
const FILES = Object.freeze([
  ['20261120_009_doctor_reassignment.sql', 'a1cfebe5e508de8f1a691d5c0f182ff16e42f0c9846478c41e2c35674f8a5f5e'],
  ['20261120_010_patients_visits.sql', 'e216d338f0c10fdb24afaddcdad231eee285d88986dc4efa792b31ae07a62d2a'],
  ['20261120_011_round2_er_post_er.sql', '234584c9eb08897e91c4505c3adea96804f0b1e670752492c2f8c03ff1caa6fd'],
  ['20261120_012_patient_portal_identity.sql', '4dcf2e1c84276fc29c3d8e3ded026eed4563629384ade9af46478cb52dea270b'],
]);
function checkArgs(args) {
  if (args.length !== 2 || args[0] !== '--apply' || args[1] !== CONFIRM) {
    throw new Error(`Usage: node scripts/round2-migrations-apply-local.cjs --apply ${CONFIRM}`);
  }
}
function guard(env) {
  if (env.ROUND2_STAGING_APPLY !== 'YES' || env.ROUND2_STAGING_DB_NAME !== EXPECTED_DB || env.ROUND2_DISPOSABLE_DB_CONFIRMED !== 'YES')
    throw new Error('Require ROUND2_STAGING_APPLY=YES, ROUND2_STAGING_DB_NAME=intelligent_er_drug_test and ROUND2_DISPOSABLE_DB_CONFIRMED=YES');
  if (env.DATABASE_URL || env.PGHOST || env.PGDATABASE || env.PGPORT || env.PGUSER || env.PGPASSWORD || env.PGSSLMODE || env.PGSERVICE)
    throw new Error('Ambiguous PG* or DATABASE_URL environment override; unset before applying');
  if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST) || env.DB_NAME !== EXPECTED_DB || String(env.DB_SSL).toLowerCase() === 'true' || env.NODE_ENV === 'production')
    throw new Error('Refusing non-local, non-test, SSL or production connection');
  if (typeof env.DB_PASSWORD !== 'string' || !env.DB_PASSWORD) throw new Error('Missing local DB_PASSWORD');
  if (!Number.isInteger(Number(env.DB_PORT || 5432)) || Number(env.DB_PORT || 5432) < 1 || Number(env.DB_PORT || 5432) > 65535)
    throw new Error('Invalid DB_PORT');
}
function loadSQL(dir) {
  return FILES.map(([name, expectedHash], idx) => {
    const buf = fs.readFileSync(path.join(dir, name));
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash !== expectedHash) throw new Error(`SQL checksum mismatch for ${name}. STOP; do not bypass this guard. Compare with uploaded reviewed SQL.`);
    let sql = buf.toString('utf8');
    if (idx > 0) {
      if ((sql.match(/^BEGIN;\s*$/gm) || []).length !== 1 || (sql.match(/^COMMIT;\s*$/gm) || []).length !== 1)
        throw new Error(`Unexpected transaction wrapper in ${name}`);
      sql = sql.replace(/^BEGIN;\s*$/gm, '').replace(/^COMMIT;\s*$/gm, '');
    }
    if (/\b(COMMIT|ROLLBACK|SAVEPOINT|TRUNCATE)\b|\bDROP\s+TABLE\b|\\copy\b/i.test(sql.replace(/--[^\n]*/g, '')))
      throw new Error(`Unsafe SQL token in ${name}`);
    return {name, hash, sql};
  });
}
async function preflight(client) {
  const {rows:[info]} = await client.query(`SELECT current_database() AS database, current_user AS db_user, current_setting('transaction_read_only') AS read_only`);
  if (info.database !== EXPECTED_DB || info.read_only !== 'off') throw new Error('DB/transaction mismatch; refuse migration');
  const {rows:[deps]} = await client.query(`SELECT to_regclass('public.users') IS NOT NULL AS users, to_regclass('public.patients') IS NOT NULL AS patients, to_regclass('public.ed_stays') IS NOT NULL AS stays, to_regclass('public.discharges') IS NOT NULL AS discharges, to_regclass('public.stay_doctor_assignments') IS NOT NULL AS assignments`);
  if (Object.values(deps).some(v => v !== true)) throw new Error('Required base tables missing');
  const {rows:[check]} = await client.query(`SELECT
    (SELECT count(*)::int FROM (SELECT stay_id FROM public.stay_doctor_assignments WHERE status='ACTIVE' GROUP BY stay_id HAVING count(*)>1) x) AS duplicate_active,
    (SELECT count(*)::int FROM public.ed_stays s WHERE EXISTS (SELECT 1 FROM public.discharges d WHERE d.stay_id=s.stay_id)) AS backfill_stays,
    (SELECT max(subject_id)::text FROM public.patients) AS max_subject,
    (SELECT max(stay_id)::text FROM public.ed_stays) AS max_stay,
    to_regclass('public.patient_profiles') IS NOT NULL AS profiles_exist,
    to_regclass('public.er_vital_entries') IS NOT NULL AS vitals_exist,
    to_regclass('public.visit_access_codes') IS NOT NULL AS codes_exist,
    to_regclass('public.visit_registration_requests') IS NOT NULL AS requests_exist,
    to_regclass('public.parvah_round2_migration_history') IS NOT NULL AS history_exists,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='round2_visit_status_check' AND conrelid='public.ed_stays'::regclass) AS visit_constraint_exists`);
  if (check.duplicate_active !== 0) throw new Error('Duplicate active doctor assignments found');
  if ([check.profiles_exist, check.vitals_exist, check.codes_exist, check.requests_exist, check.history_exists, check.visit_constraint_exists].some(Boolean))
    throw new Error('Partial or previously applied migration detected; do not rerun');
  if (check.max_subject !== null && BigInt(check.max_subject) >= 9000000000n) throw new Error('Existing subject IDs collide with planned sequence');
  if (check.max_stay !== null && BigInt(check.max_stay) >= 90000001n) throw new Error('Existing stay IDs collide with planned sequence');
  return {database:info.database,db_user:info.db_user,discharged_stays_to_backfill:check.backfill_stays,duplicate_active_doctor_stays:check.duplicate_active,max_subject_id:check.max_subject,max_stay_id:check.max_stay};
}
async function postflight(client, backfillCount) {
  const {rows:[inventory]} = await client.query(`SELECT
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='patients' AND column_name IN ('full_name','date_of_birth','phone','is_temporary')) AS patient_columns,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='ed_stays' AND column_name IN ('visit_status','departed_at','departed_by')) AS stay_columns,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='stay_doctor_assignments' AND column_name IN ('replaced_at','replaced_by')) AS assignment_columns,
    (SELECT count(*)::int FROM (VALUES
      ('visit_access_codes'),('visit_registration_requests'),('er_vital_entries'),('patient_profiles'),('patient_visit_access'),
      ('patient_claim_attempts'),('patient_identity_reviews'),('patient_identity_audit'),('patient_allergies'),('patient_medications'),('patient_conditions')) x(t)
      WHERE to_regclass('public.'||x.t) IS NOT NULL) AS required_tables,
    to_regclass('public.parvah_patient_subject_seq') IS NOT NULL AS subject_sequence,
    to_regclass('public.parvah_stay_id_seq') IS NOT NULL AS stay_sequence,
    to_regclass('public.round2_one_active_doctor_per_stay') IS NOT NULL AS doctor_index,
    to_regclass('public.visit_access_codes_one_active_per_stay') IS NOT NULL AS active_code_index,
    (SELECT convalidated FROM pg_constraint WHERE conname='round2_visit_status_check' AND conrelid='public.ed_stays'::regclass) AS status_constraint_validated`);
  if (inventory.patient_columns !== 4 || inventory.stay_columns !== 3 || inventory.assignment_columns !== 2 || inventory.required_tables !== 11 ||
      !inventory.subject_sequence || !inventory.stay_sequence || !inventory.doctor_index || !inventory.active_code_index || !inventory.status_constraint_validated)
    throw new Error('Post-apply schema check failed: '+JSON.stringify(inventory));
  const {rows:[statuses]} = await client.query(`SELECT count(*)::int AS count FROM public.ed_stays s WHERE s.visit_status='DISCHARGE_AUTHORIZED' AND EXISTS (SELECT 1 FROM public.discharges d WHERE d.stay_id=s.stay_id)`);
  if (statuses.count !== backfillCount) throw new Error('Discharge status backfill count inconsistent');
  return { ...inventory, verified_discharge_authorizations: statuses.count };
}
async function main() {
  checkArgs(process.argv.slice(2));
  const envPath=path.join(ROOT,'backend','.env.pre-er-test');
  if (!fs.existsSync(envPath)) throw new Error('Local backend/.env.pre-er-test not found');
  const dotenv=require(path.join(ROOT,'backend','node_modules','dotenv'));
  const env={...process.env, ...dotenv.parse(fs.readFileSync(envPath))};
  guard(env);
  const migrations=loadSQL(path.join(ROOT,'migrations'));
  const {Pool}=require(path.join(ROOT,'backend','node_modules','pg'));
  const pool=new Pool({host:env.DB_HOST,port:Number(env.DB_PORT || 5432),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,ssl:false,connectionTimeoutMillis:5000,max:1});
  let client, active=false;
  try {
    client=await pool.connect();
    await client.query('BEGIN'); active=true;
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='120s'");
    // Nonblocking advisory lock scoped to this transaction, preventing concurrent runner instances.
    const {rows:[lock]}=await client.query('SELECT pg_try_advisory_xact_lock(20261120, 9012) AS acquired');
    if (!lock.acquired) throw new Error('Another Round 2 migration runner is active');
    const checks=await preflight(client);
    console.log('ROUND2_APPLY_PREFLIGHT_OK',JSON.stringify(checks));
    // Prevent unexpected concurrent writes during schema inspection and migration.
    // The SQL's ALTER statements acquire stronger locks as needed.
    for (const m of migrations) {
      console.log('APPLY_START',m.name);
      await client.query(m.sql);
      console.log('APPLY_SQL_OK',m.name);
    }
    // Migration 011 created the check constraint NOT VALID. Validate against all existing rows.
    await client.query('ALTER TABLE public.ed_stays VALIDATE CONSTRAINT round2_visit_status_check');
    await client.query(`CREATE TABLE public.parvah_round2_migration_history (
      migration_name text PRIMARY KEY,
      sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text NOT NULL DEFAULT current_user
    )`);
    for (const m of migrations) await client.query('INSERT INTO public.parvah_round2_migration_history(migration_name,sha256) VALUES ($1,$2)',[m.name,m.hash]);
    const verification=await postflight(client,checks.discharged_stays_to_backfill);
    console.log('ROUND2_SCHEMA_POSTFLIGHT_OK',JSON.stringify(verification));
    // Explicit one-time final commit; no internal SQL COMMIT tokens are permitted.
    await client.query('COMMIT'); active=false;
    console.log('ROUND2_MIGRATION_APPLY_COMMITTED',JSON.stringify({database:EXPECTED_DB,files:migrations.map(m=>m.name),history_table:'public.parvah_round2_migration_history'}));
  } catch(err) {
    if (active && client) {
      try {await client.query('ROLLBACK');console.error('ROUND2_APPLY_ROLLBACK_COMPLETE; no changes committed');}
      catch(rollbackError){console.error('ROLLBACK_FAILED: connection status must be investigated:',rollbackError.message);}
    }
    throw err;
  } finally {if(client)client.release(); await pool.end();}
}
if(require.main === module) main().catch(e=>{console.error('ROUND2_APPLY_BLOCKED:',e.message);process.exitCode=1});
module.exports={checkArgs,guard,loadSQL,CONFIRM,EXPECTED_DB,FILES};
