#!/usr/bin/env node
'use strict';
// B10 verification only. Does not repeat historical backfill or make writes.
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const backendRequire=require('node:module').createRequire(path.join(root,'backend/package.json'));
backendRequire('dotenv').config({path:path.resolve(process.env.PRE_ER_TEST_ENV_FILE||path.join(root,'backend/.env.pre-er-test')),override:true,quiet:true});
const {Client}=backendRequire('pg');
function isLocal(v){return ['127.0.0.1','::1','localhost','::ffff:127.0.0.1'].includes(String(v||'').replace(/\/(?:32|128)$/,'').toLowerCase());}
function environmentOk(e){return Boolean(isLocal(e.DB_HOST)&&e.DB_NAME===e.PRE_ER_TEST_DATABASE_NAME&&/_test$|_ci$/.test(e.DB_NAME||'')&&e.NODE_ENV!=='production'&&e.DB_SSL!=='true');}
async function main(){
 if(!environmentOk(process.env))throw Error('SAFETY STOP: use the approved local _test/_ci database with matching PRE_ER_TEST_DATABASE_NAME');
 const db=new Client({host:process.env.DB_HOST,port:process.env.DB_PORT||5432,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,ssl:false});
 try{
  await db.connect();
  await db.query('BEGIN TRANSACTION READ ONLY');
  const info=(await db.query("SELECT current_database() db, inet_server_addr()::text server_address, current_setting('transaction_read_only') ro")).rows[0];
  if(info.db!==process.env.DB_NAME||!isLocal(info.server_address)||info.ro!=='on')throw Error('SAFETY STOP: connected database not the expected local read-only test database');
  const columns=(await db.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('observations','news2_results_real','news2_results','audit_events') ORDER BY table_name,column_name`)).rows;
  const have=(table,col)=>columns.some(x=>x.table_name===table&&x.column_name===col);
  for(const f of ['consciousness_assumed','oxygen_support_assumed','spo2_scale_assumed'])if(!have('observations',f))throw Error(`Missing assumption column ${f}`);
  const count=(await db.query(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER(WHERE consciousness_assumed IS TRUE AND oxygen_support_assumed IS TRUE AND spo2_scale_assumed IS TRUE)::int all_assumed,
    COUNT(*) FILTER(WHERE consciousness_assumed IS NULL OR oxygen_support_assumed IS NULL OR spo2_scale_assumed IS NULL)::int unknown_flag_rows,
    COUNT(*) FILTER(WHERE consciousness IS NULL OR oxygen_support IS NULL OR spo2_scale IS NULL)::int missing_input_rows
    FROM observations WHERE data_source=$1`,['MIMIC_IV_ED_DEMO_v2.2'])).rows[0];
  const news2=(await db.query(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER (WHERE o.observation_id IS NULL)::int missing_observation_link,
    COUNT(*) FILTER(WHERE o.consciousness_assumed IS TRUE OR o.oxygen_support_assumed IS TRUE OR o.spo2_scale_assumed IS TRUE)::int based_on_assumptions,
    COUNT(*) FILTER (WHERE o.consciousness IS NULL OR o.oxygen_support IS NULL OR o.spo2_scale IS NULL)::int based_on_missing_inputs
    FROM news2_results_real n LEFT JOIN observations o ON n.observation_id=o.observation_id`)).rows[0];
  const output={database:info.db,transaction:'READ_ONLY',legacy_observations:count,stored_news2:news2,
   api_columns_exist:['consciousness_assumed','oxygen_support_assumed','spo2_scale_assumed'].every(f=>have('observations',f)),
   news2_has_durable_assumption_snapshot:have('news2_results_real','based_on_assumed_inputs')||have('news2_results','based_on_assumed_inputs'),
   audit_events_table_present:columns.some(x=>x.table_name==='audit_events'),
   interpretation:'Existing API derives assumed status from current observations. Derivation is not a historical immutable snapshot.'};
  console.log(JSON.stringify(output,null,2));
  if(!output.news2_has_durable_assumption_snapshot||!output.audit_events_table_present)console.log('B10 NOT CLOSED: durable NEWS2/audit assumption provenance is not established.');
  return output;
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={environmentOk,isLocal};
