#!/usr/bin/env node
'use strict';
/* B04: reproducible, local-only, disposable test database bootstrap.
 * A new EMPTY database is mandatory. --verify performs read-only checks.
 * No access to the existing intelligent_er_drug_test or to remote databases.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'backend/package.json'));
const MIGRATIONS = [
  '20261116_001_observation_temperature_units.sql',
  '20261116_002_observation_spo2_scale_assumed.sql',
  '20261119_003_audit1_data_quality.sql'
];
const BASELINE_ID = 'baseline-schema-export-20261119';
const BASELINE = path.join(root, 'schema-export.sql');
const REQUIRED = ['users','patients','ed_stays','observations','emergency_cases', 'doctor_profiles','stay_doctor_assignments','prescriptions','clinical_alerts','drug_safety_results','decision_support_results'];
const METADATA_LINE = /^ALTER TABLE ONLY public\.[A-Za-z_][A-Za-z_0-9]* ALTER COLUMN [A-Za-z_][A-Za-z_0-9]* SET \(pg_attver=\d+\);\r?\n?/gm;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function addr(s) { return String(s || '').trim().replace(/^\[|\]$/g, '').replace(/\/\d+$/, '').toLowerCase(); }
function loopback(s) { return ['localhost','127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr(s)); }
function validateTarget(e, apply) {
  const errs=[];
  if (apply && e.B04_ALLOW_DISPOSABLE_BOOTSTRAP !== 'YES') errs.push('B04_ALLOW_DISPOSABLE_BOOTSTRAP=YES is required');
  if (e.NODE_ENV === 'production') errs.push('production forbidden');
  if (!e.DB_NAME || !/_test$|_ci$/.test(e.DB_NAME) || e.DB_NAME !== e.PRE_ER_TEST_DATABASE_NAME) errs.push('DB_NAME must be a matching _test/_ci name');
  if (e.DB_NAME === 'intelligent_er_drug_test') errs.push('existing populated audit database is prohibited');
  if (!loopback(e.DB_HOST)) errs.push('DB_HOST must be local loopback');
  if (!e.DB_USER || !e.DB_PASSWORD || e.DB_SSL === 'true') errs.push('local credentials and DB_SSL=false required');
  if (apply && e.B04_CONFIRM_EMPTY_REBUILD !== e.DB_NAME) errs.push('B04_CONFIRM_EMPTY_REBUILD must equal the target DB name');
  return errs;
}
function prepareDump(original, versionNum) {
  const match = original.match(/^-- Dumped from database version (\d+)\.(\d+)/m);
  if (!match || Number(match[1]) !== 18) throw Error('Only the known PostgreSQL 18 schema export is supported');
  if (versionNum < 180004) throw Error('PostgreSQL 18.4+ required for the tested compatibility path');
  if (/^\s*(COPY\s+\S+\s+FROM\s+stdin|INSERT\s+INTO)\b/im.test(original)) throw Error('Refusing non-schema-only SQL');
  const removed = [...original.matchAll(METADATA_LINE)].length;
  if (removed !== 21) throw Error(`Expected exactly 21 pg_attver metadata directives; got ${removed}`);
  const converted = original.replace(METADATA_LINE, '');
  if (/\bpg_attver\b/i.test(converted)) throw Error('Unrecognized pg_attver entry remains');
  const names = new Set([...converted.matchAll(/CREATE\s+TABLE\s+(?:public\.)?([a-z][\w]*)\s*\(/gi)].map(m=>m[1]));
  const missing = REQUIRED.filter(x=>!names.has(x));
  if (missing.length) throw Error(`Baseline is missing tables: ${missing.join(',')}`);
  return {converted, removed, sourceVersion: `${match[1]}.${match[2]}`, baselineSha: sha(original), baselineTables:names.size};
}
function loadMigrations(){return MIGRATIONS.map(file=>{
  const p=path.join(root,'migrations',file);
  const sql=fs.readFileSync(p,'utf8');
  // Existing migrations 001 & 002 contain their own BEGIN and COMMIT;
  // remove ONLY standalone transaction statements to let this runner own the transaction.
  const body=sql.replace(/^\s*(?:BEGIN|COMMIT);\s*$/gmi, '');
  if (/^\s*(BEGIN|COMMIT|ROLLBACK);\s*$/mi.test(body) || /\\[a-z]/i.test(body)) throw Error(`Unsafe migration format: ${file}`);
  return {id:file.replace(/\.sql$/,''),sql:body,checksum:sha(sql)};
});}
async function querySchema(client){
 const q=await client.query(`SELECT
  (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
  (SELECT COUNT(*)::int FROM information_schema.views WHERE table_schema='public') AS views,
  (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname='public') AS indexes,
  (SELECT COUNT(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace) AS constraints,
  (SELECT COUNT(*)::int FROM public.observations) AS observations`);
 return q.rows[0];
}
async function verify(client, baselineSha, migrations, baselineTableCount){
 const migrationTable=(await client.query("SELECT to_regclass('public.schema_migrations') AS ledger")).rows[0].ledger;
 if(!migrationTable) throw Error('schema_migrations ledger is absent; manual restore is not a verified automated rebuild');
 const rows=(await client.query('SELECT migration_id,sha256 FROM public.schema_migrations')).rows;
 const want=new Map([[BASELINE_ID,baselineSha],...migrations.map(m=>[m.id,m.checksum])]);
 if(rows.length !== want.size) throw Error(`Expected ${want.size} ledger entries; found ${rows.length}`);
 for(const [id,hash] of want){const saved=rows.find(r=>r.migration_id===id);if(!saved || saved.sha256!==hash)throw Error(`Missing or mismatched migration checksum: ${id}`);}
 const state=await querySchema(client);
 if(state.tables !== baselineTableCount+3)throw Error(`Expected ${baselineTableCount+3} tables, got ${state.tables}`);
 if(state.observations !== 0)throw Error('Rebuilt schema contains observation data');
 const c=(await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='observations' AND column_name = ANY($1)`,[['spo2_scale_assumed','temperature_source_unit','temperature_unit_status','temperature_celsius_verified']])).rows.map(r=>r.column_name);
 if(c.length!==4)throw Error(`Expected 4 new observation columns; got ${c.length}`);
 for(const n of [...REQUIRED,'observation_quality_reviews','dataset_time_semantics'])if(!(await client.query('SELECT to_regclass($1) AS object',[`public.${n}`])).rows[0].object)throw Error(`Missing ${n}`);
 return {...state, columns:c.sort(), migrations:rows.length, migration_checksums_valid:true};
}
async function run(){
 const apply=process.argv.includes('--apply');
 if(process.argv.slice(2).some(a=>!['--apply','--verify'].includes(a)))throw Error('Usage: node scripts/b04-rebuild-verified.js [--apply|--verify]');
 if(apply && process.argv.includes('--verify'))throw Error('Choose one mode');
 if(!process.env.PRE_ER_TEST_ENV_FILE)throw Error('PRE_ER_TEST_ENV_FILE must explicitly reference a rebuild-only .env file');
 const envFile=path.resolve(process.cwd(),process.env.PRE_ER_TEST_ENV_FILE);
 req('dotenv').config({path:envFile,override:true,quiet:true});
 const errs=validateTarget(process.env,apply);if(errs.length)throw Error('SAFETY STOP: '+errs.join('; '));
 const original=fs.readFileSync(BASELINE,'utf8');
 const migrations=loadMigrations();
 const pg=req('pg');const client=new pg.Client({host:process.env.DB_HOST,port:process.env.DB_PORT||5432,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:false});
 let tempDir=null;
 try{
  await client.connect();
  const meta=(await client.query("SELECT current_database() AS db, current_setting('server_version_num')::int AS version, host(inet_server_addr()) AS address")).rows[0];
  if(meta.db!==process.env.DB_NAME || !loopback(meta.address))throw Error(`SAFETY STOP: connected database/server is not approved (${meta.db}, ${meta.address})`);
  const prep=prepareDump(original,meta.version);
  if(!apply){console.log(JSON.stringify({mode:'VERIFY_READ_ONLY',database:meta.db,verification:await verify(client,prep.baselineSha,migrations,prep.baselineTables)},null,2));return;}
  const objects=(await client.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`)).rows[0].n;
  if(objects!==0)throw Error(`SAFETY STOP: rebuild DB not empty (${objects} objects). Never reapply into an existing database.`);
  tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'parvah-b04-'));
  const temporarySql=path.join(tempDir,'compatible-schema.sql');
  fs.writeFileSync(temporarySql,prep.converted,{mode:0o600});
  const args=['-X','-v','ON_ERROR_STOP=1','--single-transaction','-h',process.env.DB_HOST,'-p',String(process.env.DB_PORT||5432),'-U',process.env.DB_USER,'-d',meta.db,'-f',temporarySql];
  const out=cp.spawnSync(process.env.PSQL_PATH||'psql',args,{env:{...process.env,PGPASSWORD:process.env.DB_PASSWORD},encoding:'utf8',maxBuffer:1024*1024});
  if(out.error||out.status!==0)throw Error('Baseline restore failed: '+(out.error?.message||out.stderr||'psql error').slice(-800));
  console.log('BASELINE_RESTORED',JSON.stringify({database:meta.db,source_version:prep.sourceVersion,server_version_num:meta.version,metadata_lines_removed:prep.removed,baseline_tables:prep.baselineTables}));
  await client.query('BEGIN');
  try{await client.query('CREATE TABLE public.schema_migrations (migration_id text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');await client.query('INSERT INTO public.schema_migrations(migration_id,sha256) VALUES($1,$2)',[BASELINE_ID,prep.baselineSha]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
  for(const m of migrations){
    await client.query('BEGIN');
    try{await client.query(m.sql);await client.query('INSERT INTO public.schema_migrations(migration_id,sha256) VALUES($1,$2)',[m.id,m.checksum]);await client.query('COMMIT');console.log('MIGRATION_APPLIED',m.id);}catch(e){await client.query('ROLLBACK');throw Error(`Failed ${m.id}: ${e.message}`);}
  }
  const report=await verify(client,prep.baselineSha,migrations,prep.baselineTables);
  console.log(JSON.stringify({result:'B04_AUTOMATED_REBUILD_VERIFIED',database:meta.db,verification:report},null,2));
 }finally{if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});await client.end().catch(()=>{});}
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={loopback,validateTarget,prepareDump,loadMigrations,BASELINE_ID,MIGRATIONS};
