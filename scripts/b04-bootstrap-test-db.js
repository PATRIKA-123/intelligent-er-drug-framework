#!/usr/bin/env node
'use strict';
// Baseline restore ONLY into a new, empty, disposable PostgreSQL 18+ test DB.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'schema-export.sql');
const pg = require(path.join(root, 'backend/node_modules/pg'));
require(path.join(root, 'backend/node_modules/dotenv')).config({path:path.resolve(process.env.PRE_ER_TEST_ENV_FILE||path.join(root,'.env')),override:false});
const REQUIRED=['users','patients','ed_stays','observations','emergency_cases','doctor_profiles','stay_doctor_assignments','prescriptions','clinical_alerts','drug_safety_results'];
function preflight(e,apply){
  const errors=[];
  if(!apply)errors.push('use --apply');
  if(e.B04_ALLOW_DISPOSABLE_BOOTSTRAP!=='YES')errors.push('set B04_ALLOW_DISPOSABLE_BOOTSTRAP=YES');
  if(!e.DB_NAME||!/_test$|_ci$/.test(e.DB_NAME)||e.DB_NAME!==e.PRE_ER_TEST_DATABASE_NAME)errors.push('DB_NAME must end in _test or _ci and equal PRE_ER_TEST_DATABASE_NAME');
  if(!e.DB_HOST||!e.DB_USER||!e.DB_PASSWORD)errors.push('DB_HOST, DB_USER and DB_PASSWORD required');
  if(e.NODE_ENV==='production')errors.push('NODE_ENV=production prohibited');
  if(e.DB_HOST&&!['localhost','127.0.0.1','::1'].includes(e.DB_HOST)&&e.B04_ALLOW_REMOTE_TEST_DB!=='YES')errors.push('remote database requires B04_ALLOW_REMOTE_TEST_DB=YES');
  return errors;
}
function inventory(sql){return new Set([...sql.matchAll(/CREATE\s+TABLE\s+(?:public\.)?([a-z][\w]*)\s*\(/gi)].map(x=>x[1].toLowerCase()));}
async function run(){
  const errors=preflight(process.env,process.argv.includes('--apply'));
  if(errors.length)throw Error('SAFETY STOP: '+errors.join('; '));
  if(!fs.existsSync(base))throw Error('Missing repository root schema-export.sql');
  const sql=fs.readFileSync(base,'utf8');
  if(/^\s*(?:COPY\s+\S+\s+FROM\s+stdin|INSERT\s+INTO)\b/im.test(sql))throw Error('Not a schema-only dump; abort');
  const missing=REQUIRED.filter(t=>!inventory(sql).has(t));
  if(missing.length)throw Error('Schema baseline missing: '+missing.join(', '));
  const client=new pg.Client({host:process.env.DB_HOST,port:process.env.DB_PORT||5432,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:false});
  try{
    await client.connect();
    const info=(await client.query("SELECT current_database() AS name, current_setting('server_version_num')::int AS version")).rows[0];
    if(info.name!==process.env.PRE_ER_TEST_DATABASE_NAME)throw Error('Connected to unexpected database');
    if(info.version<180000)throw Error('Export was taken from PostgreSQL 18; require PostgreSQL 18+ disposable DB');
    const exists=(await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE' LIMIT 1")).rowCount;
    if(exists)throw Error('Database is not empty; refusing any changes');
    console.log('Restoring complete schema-only baseline into EMPTY test database:',info.name);
    const args=['-X','-v','ON_ERROR_STOP=1','--single-transaction','-h',process.env.DB_HOST,'-p',String(process.env.DB_PORT||5432),'-U',process.env.DB_USER,'-d',info.name,'-f',base];
    const result=cp.spawnSync(process.env.PSQL_PATH||'psql',args,{encoding:'utf8',env:{...process.env,PGPASSWORD:process.env.DB_PASSWORD},maxBuffer:10*1024*1024});
    if(result.error)throw Error('Could not execute psql; install PostgreSQL 18 client or configure PSQL_PATH');
    if(result.status!==0)throw Error('psql restore failed: '+(result.stderr||'').slice(-1000));
    const tables=new Set((await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows.map(x=>x.table_name));
    const absent=REQUIRED.filter(t=>!tables.has(t));
    if(absent.length)throw Error('Missing restored tables: '+absent.join(', '));
    await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (migration_id text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('INSERT INTO public.schema_migrations(migration_id,sha256) VALUES($1,$2) ON CONFLICT DO NOTHING',['baseline-schema-export-20261119',crypto.createHash('sha256').update(sql).digest('hex')]);
    console.log('B04 schema bootstrap complete. Schema-only, no patient data.');
  }finally{await client.end().catch(()=>{});}
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={preflight,inventory,REQUIRED};
