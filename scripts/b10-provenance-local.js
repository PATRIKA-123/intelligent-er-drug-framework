#!/usr/bin/env node
'use strict';
// B10 local-test-only transactional migration. Does NOT repeat assumed-input backfill.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const net=require('node:net');
const root=path.resolve(__dirname,'..');const backendRequire=require('node:module').createRequire(path.join(root,'backend/package.json'));
function loopback(addr){let a=String(addr||'').trim().toLowerCase().replace(/\/\d+$/,'');if(a.startsWith('::ffff:'))a=a.slice(7);return ['localhost','127.0.0.1','::1'].includes(a);}
function preflight(e,args){const errs=[];if(!args.every(a=>['--apply','--verify'].includes(a))||args.includes('--apply')===args.includes('--verify'))errs.push('choose exactly --apply or --verify');
if(e.DB_NAME!=='intelligent_er_drug_test'||e.PRE_ER_TEST_DATABASE_NAME!==e.DB_NAME)errs.push('target must be the isolated intelligent_er_drug_test database');
if(!loopback(e.DB_HOST)||e.DB_SSL==='true'||e.NODE_ENV==='production')errs.push('local non-SSL non-production only');
if(!e.DB_PASSWORD||!e.DB_USER)errs.push('database credentials missing');
if(args.includes('--apply')&&e.B10_CONFIRM_LOCAL_TEST!=='intelligent_er_drug_test')errs.push('B10_CONFIRM_LOCAL_TEST must exactly match test database');return errs;}
function sha(t){return crypto.createHash('sha256').update(t).digest('hex');}
async function main(){const args=process.argv.slice(2);const envfile=process.env.PRE_ER_TEST_ENV_FILE;if(!envfile)throw Error('PRE_ER_TEST_ENV_FILE is required');
backendRequire('dotenv').config({path:path.resolve(envfile),override:true,quiet:true});const problems=preflight(process.env,args);if(problems.length)throw Error('SAFETY STOP: '+problems.join('; '));
const pg=backendRequire('pg');const client=new pg.Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:false});
const sql=fs.readFileSync(path.join(root,'migrations/20261119_004_news2_input_provenance.sql'),'utf8');const sum=sha(sql),id='20261119_004_news2_input_provenance';
try{await client.connect();const info=(await client.query("SELECT current_database() AS db, inet_server_addr()::text AS addr, current_setting('server_version_num')::int AS version, pg_is_in_recovery() AS standby")).rows[0];
if(info.db!=='intelligent_er_drug_test'||!loopback(info.addr)||info.version<180000||info.standby)throw Error('Connected server is not local writable PG18+ disposable test DB');
const existing=(await client.query("SELECT to_regclass('public.schema_migrations') AS ledger,to_regclass('public.news2_input_provenance') AS provenance")).rows[0];if(!existing.ledger)throw Error('Batch 10 migration ledger is absent');
const migrated=await client.query('SELECT sha256 FROM public.schema_migrations WHERE migration_id=$1',[id]);if(migrated.rowCount && migrated.rows[0].sha256!==sum)throw Error('Migration checksum mismatch');
if(args.includes('--verify')){if(!migrated.rowCount||!existing.provenance)throw Error('B10 migration is not applied');const stats=await client.query(`SELECT (SELECT count(*)::int FROM public.news2_results_real) n,(SELECT count(*)::int FROM public.news2_input_provenance) p,(SELECT count(*)::int FROM public.news2_input_provenance WHERE provenance_origin='HISTORICAL_DERIVED') historical,(SELECT count(*)::int FROM public.news2_provenance_audit) audited`);console.log(JSON.stringify({mode:'VERIFY_READ_ONLY',database:info.db,checksum_valid:true,stats:stats.rows[0]},null,2));return;}
if(migrated.rowCount)throw Error('B10 migration already applied; use --verify');if(existing.provenance)throw Error('Provenance table exists without migration ledger: manual reconciliation required');
await client.query('BEGIN');try{await client.query('SET LOCAL lock_timeout = \'5s\'');await client.query('SET LOCAL statement_timeout = \'30s\'');await client.query(sql);await client.query('INSERT INTO public.schema_migrations(migration_id,sha256) VALUES($1,$2)',[id,sum]);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}
const count=await client.query('SELECT count(*)::int AS n FROM public.news2_input_provenance');console.log(JSON.stringify({result:'B10_LOCAL_PROVENANCE_APPLIED',database:info.db,snapshots:count.rows[0].n,origin:'HISTORICAL_DERIVED',checksum_valid:true},null,2));
}finally{await client.end().catch(()=>{})}}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});module.exports={loopback,preflight,sha};
