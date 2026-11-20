#!/usr/bin/env node
'use strict';
/** B04/B09/B10/B17: safe, versioned, local TEST database only.
 * Default: read-only preflight. --apply --confirm-disposable authorizes test DB mutation.
 * Never runs against remote DB, Neon, or a name other than intelligent_er_drug_test.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const backendRequire = createRequire(path.join(root, 'backend', 'package.json'));
const argv = process.argv.slice(2);
const known = ['--apply','--confirm-disposable'];
const unwanted = argv.filter(x => !known.includes(x));
const apply = argv.includes('--apply');
const confirmed = argv.includes('--confirm-disposable');
function fail(msg) { throw new Error('SAFETY STOP: ' + msg); }
function preflight(env, flags={apply,confirmed}) {
  const host = (env.DB_HOST || '').trim();
  const db = (env.DB_NAME || '').trim();
  if (unwanted.length) fail('unknown options: '+unwanted.join(' '));
  if (!['localhost','127.0.0.1','::1'].includes(host)) fail('only local PostgreSQL is allowed');
  if (db !== 'intelligent_er_drug_test' || env.PRE_ER_TEST_DATABASE_NAME !== db)
    fail('DB_NAME and PRE_ER_TEST_DATABASE_NAME must both equal intelligent_er_drug_test');
  if (env.NODE_ENV === 'production') fail('NODE_ENV=production is forbidden');
  if (env.DB_SSL === 'true') fail('DB_SSL=true is forbidden for local tests');
  if (!env.DB_USER || !env.DB_PASSWORD) fail('local DB credentials are missing');
  if (flags.apply && !flags.confirmed) fail('--apply requires --confirm-disposable');
  return true;
}
const migrations = [
  ['20261116_001_observation_temperature_units', 'migrations/20261116_001_observation_temperature_units.sql'],
  ['20261116_002_observation_spo2_scale_assumed', 'migrations/20261116_002_observation_spo2_scale_assumed.sql'],
  ['20261119_003_audit1_data_quality', 'migrations/20261119_003_audit1_data_quality.sql'],
];
function migrationFiles() {
  return migrations.map(([id,rel])=>{
    const sql=fs.readFileSync(path.join(root,rel),'utf8');
    return {id,rel,sql,sha:crypto.createHash('sha256').update(sql).digest('hex')};
  });
}
function assertServer(row){
  if (row.database_name!=='intelligent_er_drug_test') fail('connected to unexpected database');
  // Windows PostgreSQL can report IPv4 loopback as an IPv6-mapped address.
  // Only literal loopback endpoints are accepted; private LAN addresses are NOT.
  const endpoint = String(row.server_address ?? '').toLowerCase();
  // inet_server_addr()::text includes host-length CIDR suffixes in PostgreSQL,
  // e.g. ::1/128 or 127.0.0.1/32. Match EXACT host-length loopbacks only.
  const localEndpoints = new Set([
    '127.0.0.1', '127.0.0.1/32',
    '::1', '::1/128',
    '0:0:0:0:0:0:0:1', '0:0:0:0:0:0:0:1/128',
    '::ffff:127.0.0.1', '::ffff:127.0.0.1/128',
    '0:0:0:0:0:ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1/128',
  ]);
  if (!localEndpoints.has(endpoint))
    fail('server is not local (reported address: ' + endpoint + ')');
  if (Number(row.version_num)<180000) fail('PostgreSQL 18+ required for this baseline');
}
const getInfo = "SELECT current_database() database_name, inet_server_addr()::text server_address, current_setting('server_version_num') version_num";
async function count(client,sql, params=[]) { return Number((await client.query(sql,params)).rows[0].n); }
async function main() {
  const { Client } = backendRequire('pg');
  const dotenv = backendRequire('dotenv');
  const envFile=path.resolve(process.env.PRE_ER_TEST_ENV_FILE || path.join(root,'backend','.env.pre-er-test'));
  dotenv.config({path:envFile,override:false,quiet:true});
  preflight(process.env);
  const files=migrationFiles();
  const c=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:false,connectionTimeoutMillis:8000,statement_timeout:20000,application_name:'audit1_batch10_disposable'});
  await c.connect();
  try {
    const server=(await c.query(getInfo)).rows[0];
    assertServer(server);
    await c.query('BEGIN');
    try {
      if (!apply) await c.query('SET TRANSACTION READ ONLY');
      // Inspect migration state before modifying anything. No assumptions about untracked manual migrations.
      const ledgerPresent = (await c.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present")).rows[0].present;
      let recorded=[];
      if (ledgerPresent) {
        const cols=(await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations'")).rows.map(r=>r.column_name);
        if (!['migration_id','sha256'].every(x=>cols.includes(x))) fail('incompatible existing schema_migrations table');
        recorded=(await c.query('SELECT migration_id, sha256 FROM public.schema_migrations')).rows;
      }
      const ledger=new Map(recorded.map(r=>[r.migration_id,r.sha256]));
      const plan=files.map(f=>({migration:f.id,operation:ledger.has(f.id)?'ALREADY_RECORDED':'APPLY',checksum_ok:!ledger.has(f.id)||ledger.get(f.id)===f.sha}));
      if (plan.some(p=>!p.checksum_ok)) fail('migration checksum mismatch: inspect history before continuing');
      const obsCols = new Set((await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='observations'")).rows.map(r=>r.column_name));
      console.log(JSON.stringify({db:server.database_name, mode:apply?'APPLY_LOCAL_TEST':'DRY_RUN_READ_ONLY',migration_plan:plan,observations_columns_present:[...obsCols].sort()},null,2));
      if (!apply) { await c.query('ROLLBACK'); return; }
      await c.query('SELECT pg_advisory_xact_lock(2110,1710)');
      if (!ledgerPresent) await c.query('CREATE TABLE public.schema_migrations (migration_id text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      for (const f of files) {
        if (ledger.has(f.id)) continue;
        // Existing migration files may include BEGIN/COMMIT; strip these outer wrappers,
        // so all changes and ledger writes are covered by this ONE transaction.
        const stripped=f.sql.replace(/^\s*BEGIN\s*;\s*$/gmi,'').replace(/^\s*COMMIT\s*;\s*$/gmi,'');
        await c.query(stripped);
        await c.query('INSERT INTO public.schema_migrations(migration_id,sha256) VALUES($1,$2)',[f.id,f.sha]);
        console.log('Applied',f.id);
      }
      // B09: classify and store source unit conservatively without ever changing raw temperature.
      // F-range is converted; C-looking input stays UNVERIFIED (canonical null).
      const units=await c.query(`UPDATE public.observations SET
        temperature_source_unit = CASE WHEN temperature BETWEEN 77 AND 113 THEN 'F' WHEN temperature BETWEEN 25 AND 45 THEN 'C' ELSE NULL END,
        temperature_unit_status = CASE WHEN temperature BETWEEN 77 AND 113 THEN 'CONVERTED_FROM_F' WHEN temperature BETWEEN 25 AND 45 THEN 'UNVERIFIED_CELSIUS' ELSE 'IMPLAUSIBLE' END,
        temperature_celsius_verified = CASE WHEN temperature BETWEEN 77 AND 113 THEN round((temperature-32)*5/9,1) ELSE NULL END
        WHERE temperature_unit_status IS NULL RETURNING observation_id`);
      // B10: never infer "normal" measured readings from absent CSV fields. This pass
      // deliberately leaves existing values and assumed flags unchanged, unless
      // provenance is established separately by the existing reviewed backfill script.
      // Rows whose provenance is unknown remain unknown, NOT falsely marked assumed.
      // B17: review candidate implausible systolic pressures; preserve raw values.
      const flagged=await c.query(`INSERT INTO public.observation_quality_reviews
          (observation_id,data_source,systolic_bp_review_required,quality_reason)
        SELECT observation_id,data_source,TRUE,'SYSTOLIC_BP_OUTSIDE_DEMO_REVIEW_RANGE'
        FROM public.observations WHERE (systolic_bp<40 OR systolic_bp>300)
        ON CONFLICT(observation_id) DO NOTHING RETURNING observation_id`);
      await c.query(`INSERT INTO public.dataset_time_semantics(data_source,privacy_shifted,time_basis,display_note)
        VALUES ('MIMIC_IV_ED_DEMO_v2.2',true,'DEIDENTIFIED_SHIFTED',
        'Demo timestamps are shifted for privacy; retain relative order and never display as current patient care.')
        ON CONFLICT(data_source) DO NOTHING`);
      await c.query('COMMIT');
      console.log(JSON.stringify({result:'LOCAL_TEST_BATCH10_APPLIED',temperature_rows_classified:units.rowCount,outlier_review_rows_added:flagged.rowCount,b10:'SpO2 assumption flag added; legacy provenance requires reviewed backfill, no measurements changed'},null,2));
    } catch(e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
  } finally { await c.end().catch(()=>{}); }
}
if (require.main===module) main().catch(e=>{ console.error(e.message);process.exitCode=1; });
module.exports={preflight,migrationFiles,assertServer};
