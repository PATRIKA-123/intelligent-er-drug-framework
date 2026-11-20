#!/usr/bin/env node
'use strict';
// B10 read-only authenticated API smoke test on ONLY the local disposable audit DB.
// No SQL writes, no test schemas, no backfill, no data mutation.
const path = require('node:path');
const assert = require('node:assert/strict');
const { isLoopback, validateLocalEnv, classify } = require('./test-b10-runtime-helpers');
const envPath = path.resolve(process.env.PRE_ER_TEST_ENV_FILE || '.env.pre-er-test');
require('dotenv').config({path:envPath, override:true, quiet:true});
const {Client}=require('pg');
const express=require('express');
const jwt=require('jsonwebtoken');
const env=process.env;
const failures=validateLocalEnv(env);
if(failures.length){ console.error('SAFETY STOP: '+failures.join('; ')); process.exit(2); }
let db, server, pool;
async function main(){
 db=new Client({host:env.DB_HOST,port:env.DB_PORT||5432,database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,ssl:false});
 await db.connect();
 const con=(await db.query(`SELECT current_database() db, inet_server_addr()::text addr, current_setting('server_version_num')::int ver`)).rows[0];
 if(con.db!=='intelligent_er_drug_test'||!isLoopback(con.addr)||con.ver<180000) throw Error('SAFETY STOP: unexpected connected database, server address or PostgreSQL version: '+JSON.stringify(con));
 const available=(await db.query(`SELECT to_regclass('public.news2_input_provenance') IS NOT NULL AS snapshot, to_regclass('public.news2_provenance_audit') IS NOT NULL AS audit`)).rows[0];
 if(!available.snapshot||!available.audit)throw Error('B10 migration missing');
 const counts=(await db.query(`SELECT (SELECT COUNT(*)::int FROM public.news2_results_real) n,(SELECT COUNT(*)::int FROM public.news2_input_provenance) p,(SELECT COUNT(*)::int FROM public.news2_provenance_audit WHERE event_type='HISTORICAL_RECONSTRUCTED') a`)).rows[0];
 if(counts.n!==554||counts.p!==554||counts.a!==554) throw Error('Unexpected B10 data counts: '+JSON.stringify(counts));
 const user=(await db.query(`SELECT user_id FROM public.users WHERE role='ADMIN' AND is_active IS TRUE ORDER BY user_id LIMIT 1`)).rows[0];
 if(!user) throw Error('No active ADMIN user in local test DB; cannot run authentic route. No changes made.');
 const samples=(await db.query(`SELECT n.stay_id::text stay_id,n.observation_id,p.consciousness_assumed,p.oxygen_support_assumed,p.spo2_scale_assumed,p.consciousness_missing,p.oxygen_support_missing,p.spo2_scale_missing,p.provenance_origin FROM public.news2_results_real n JOIN public.news2_input_provenance p ON p.observation_id=n.observation_id ORDER BY n.observation_id LIMIT 1`)).rows;
 if(!samples.length)throw Error('No sample NEWS2 row');
 // JWT is in-memory only. No credential or token is printed.
 const priorSecret=env.JWT_SECRET;
 if(!priorSecret)env.JWT_SECRET='b10-local-runtime-test-secret-only';
 pool=require('./db');
 const app=express();app.use('/api/stays',require('./routes/stays'));
 server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject)});
 const token=jwt.sign({user_id:Number(user.user_id)},env.JWT_SECRET,{expiresIn:'2m'});
 async function get(endpoint){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/stays/${samples[0].stay_id}/${endpoint}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});const body=await response.json();if(response.status!==200)throw Error(`${endpoint} returned ${response.status}: ${JSON.stringify(body).slice(0,180)}`);return body;}
 const obs=await get('observations');const news=await get('news2');
 const target=news.news2_results.find(x=>Number(x.observation_id)===Number(samples[0].observation_id));
 assert.ok(target,'Sample NEWS2 result missing from real endpoint');
 const original=obs.observations.find(x=>Number(x.observation_id)===Number(samples[0].observation_id));
 assert.ok(original,'Sample observation missing from real endpoint');
 const sample=samples[0];
 for(const flag of ['consciousness_assumed','oxygen_support_assumed','spo2_scale_assumed']){
  assert.equal(target[flag],sample[flag],`NEWS2 API snapshot ${flag}`);
  assert.equal(original[flag],sample[flag],`Observations API ${flag}`);
 }
 const c=classify(sample);
 assert.equal(target.based_on_assumed_inputs,c.assumed,'API assumed status');
 assert.equal(target.based_on_missing_inputs,c.missing,'API missing status');
 assert.equal(target.input_provenance_origin,sample.provenance_origin,'API origin');
 if(sample.provenance_origin!=='HISTORICAL_DERIVED')throw Error('Unexpected provenance origin for original dataset');
 console.log(JSON.stringify({result:'B10_REAL_AUTHENTICATED_API_SMOKE_PASSED',database:con.db,checks:['JWT authenticated via real users table','NEWS2 endpoint status 200','observations endpoint status 200','all three NEWS2 flags match stored snapshot','all three observation flags match source','assumed and missing statuses match stored snapshot','historical origin exposed honestly'],data_counts:counts,sample_observation_id:sample.observation_id},null,2));
}
main().catch(e=>{console.error('B10_RUNTIME_FAIL:',e.message);process.exitCode=1}).finally(async()=>{if(server)await new Promise(r=>server.close(r));if(pool)await pool.end();if(db)await db.end()});
