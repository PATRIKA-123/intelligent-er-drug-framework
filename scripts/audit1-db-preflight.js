#!/usr/bin/env node
'use strict';
/** Audit 1 local database schema inventory. No writes, no row data, no passwords in output. */
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const pkg = name => require(path.join(root, 'backend', 'node_modules', name));
pkg('dotenv').config({path: process.env.PRE_ER_TEST_ENV_FILE || path.join(root, '.env'), override: false});
const {Client} = pkg('pg');
const host = (process.env.DB_HOST || '').trim();
const dbName = (process.env.DB_NAME || '').trim();
const expected = (process.env.PRE_ER_TEST_DATABASE_NAME || '').trim();
const ALLOWED_HOSTS = new Set(['localhost','127.0.0.1','::1']);
function stop(reason){console.error('SAFETY STOP:',reason);process.exit(2)}
if (!ALLOWED_HOSTS.has(host)) stop('Only local PostgreSQL is allowed for this inventory; no Render/Neon or remote DB.');
if (!dbName || !/_test$|_ci$/.test(dbName) || dbName !== expected) stop('DB_NAME must end in _test or _ci and match PRE_ER_TEST_DATABASE_NAME.');
if (process.env.NODE_ENV === 'production') stop('NODE_ENV=production is not allowed.');
if (!process.env.DB_USER || !process.env.DB_PASSWORD) stop('DB_USER/DB_PASSWORD missing in local environment.');
const tables = ['users','patients','ed_stays','observations','observations_clean','news2_results_real','trend_results','clinical_alerts','drug_safety_results','decision_support_results','emergency_cases','stay_doctor_assignments','prescriptions','medication_mappings','medication_normalizations','schema_migrations','screening_runs','decision_support_runs','audit_events'];
const client = new Client({host, port:Number(process.env.DB_PORT || 5432), database:dbName,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:false,connectionTimeoutMillis:8000,statement_timeout:12000,application_name:'audit1_readonly_preflight'});
async function main(){
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const info=(await client.query("SELECT current_database() AS database, current_setting('server_version') AS postgres_version, current_setting('transaction_read_only') AS read_only, current_schema() AS schema")).rows[0];
    if(info.database!==expected) stop('Unexpected connected database.');
    const colRes=await client.query(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1::text[]) ORDER BY table_name, ordinal_position`,[tables]);
    const allTables=await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
    const indexRes=await client.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`, [tables]);
    const fkRes=await client.query(`SELECT conrelid::regclass::text AS table_name, conname AS constraint_name, contype AS kind, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid::regclass::text=ANY($1::text[]) ORDER BY 1,2`,[tables]);
    const byTable={};for(const r of colRes.rows){(byTable[r.table_name]??=[]).push(`${r.column_name}: ${r.data_type}${r.is_nullable==='NO'?' NOT NULL':''}`)};
    console.log(JSON.stringify({kind:'AUDIT1_LOCAL_TEST_DB_SCHEMA_ONLY',captured_at:new Date().toISOString(),connection:{database:info.database,postgres_version:info.postgres_version,read_only:info.read_only,schema:info.schema},tables_present:allTables.rows.map(r=>r.table_name),target_columns:byTable,indexes:indexRes.rows,constraints:fkRes.rows},null,2));
    await client.query('ROLLBACK');
  } finally{await client.end()}
}
main().catch(async e=>{console.error('DB preflight failed (no credentials printed):',e.code || e.name || 'UNKNOWN');await client.end().catch(()=>{});process.exitCode=1});
