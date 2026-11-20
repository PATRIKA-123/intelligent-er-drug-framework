#!/usr/bin/env node
'use strict';
// PostgreSQL release probe. Schema metadata and aggregate-only checks, never patient rows.
const path=require('node:path');
const REQUIRED={
 'stay_doctor_assignments':['ended_at','replaced_at','replaced_by','stay_id','status'],
 'patients':['full_name','date_of_birth','phone','is_temporary'],
 'ed_stays':['visit_status','departed_at','departed_by'],
 'visit_access_codes':['code_hash','expires_at','used_at','revoked_at'],
 'visit_registration_requests':['key_hash','payload_hash','stay_id'],
 'er_vital_entries':['stay_id','scoring_status','news2_score'],
 'patient_profiles':['user_id','patient_id','share_history','consent_version'],
 'patient_visit_access':['user_id','stay_id'],
 'patient_claim_attempts':['user_id','ip_digest','stay_id'],
 'patient_identity_reviews':['stay_id','status','verified_by','verification_method'],
 'patient_identity_audit':['stay_id','actor_id','action'],
 'patient_allergies':['user_id','name'],
 'patient_medications':['user_id','name'],
 'patient_conditions':['user_id','name'],
};
function guard(env){
 if(env.NODE_ENV==='production')throw Error('Refusing NODE_ENV=production');
 if(env.ROUND2_STAGING_READONLY!=='YES'||env.ROUND2_STAGING_DB_NAME?.length<3)throw Error('Set ROUND2_STAGING_READONLY=YES and ROUND2_STAGING_DB_NAME to exact disposable staging database name');
 if(env.ROUND2_STAGING_DB_NAME.toLowerCase().includes('prod'))throw Error('Refusing a staging name containing prod');
}
async function main(){
 guard(process.env);
 // Use same driver as backend; do not import backend/db (it may manage its own pool).
 const {Client}=require(path.resolve(process.cwd(),'backend/node_modules/pg'));
 const config=process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.DB_HOST,port:process.env.DB_PORT?Number(process.env.DB_PORT):5432,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD};
 const client=new Client({...config,application_name:'parvah_round2_release_readonly'});
 await client.connect();let begun=false;
 try{
  await client.query('BEGIN READ ONLY');begun=true;
  await client.query("SET LOCAL statement_timeout = '8000ms'");
  const identity=(await client.query('SELECT current_database() db, current_user db_user, current_setting(\'transaction_read_only\') read_only')).rows[0];
  if(identity.db!==process.env.ROUND2_STAGING_DB_NAME)throw Error('DATABASE NAME MISMATCH: no further checks performed');
  if(identity.read_only!=='on')throw Error('Read-only transaction not active');
  const discovered=await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'");
  const cols=new Map();for(const r of discovered.rows){if(!cols.has(r.table_name))cols.set(r.table_name,new Set());cols.get(r.table_name).add(r.column_name)}
  const missing=[];for(const [table,required] of Object.entries(REQUIRED))for(const col of required)if(!cols.get(table)?.has(col))missing.push(`${table}.${col}`);
  const flags=[];
  const dupe=cols.get('stay_doctor_assignments')?.has('status')?(await client.query("SELECT count(*)::int AS n FROM (SELECT stay_id FROM public.stay_doctor_assignments WHERE status='ACTIVE' GROUP BY stay_id HAVING count(*)>1) d")).rows[0].n:null;
  if(dupe!==null&&dupe>0)flags.push(`${dupe} stays with multiple ACTIVE doctor assignments`);
  const sequences=(await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' AND sequencename = ANY($1)",[['parvah_stay_id_seq','parvah_patient_subject_seq']])).rows.map(x=>x.sequencename);
  if(sequences.length!==2)flags.push('One or both Parvah ID sequences missing');
  const indexes=(await client.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1)",[['round2_one_active_doctor_per_stay','visit_access_codes_one_active_per_stay']])).rows.map(x=>x.indexname);
  if(indexes.length!==2)flags.push('One or both critical uniqueness indexes missing');
  console.log(JSON.stringify({check:'ROUND2_F_STAGING_READONLY',database:identity.db,db_user:identity.db_user,read_only:identity.read_only,missing_columns:missing,flags,release_gate:missing.length||flags.length?'BLOCKED':'SCHEMA_READONLY_PASS_NOT_E2E'},null,2));
  if(missing.length||flags.length)process.exitCode=1;
 } finally {if(begun)await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}
}
if(require.main===module)main().catch(e=>{console.error('ROUND2_F_STAGING_CHECK_FAILED:',e.message);process.exitCode=1});
module.exports={guard,REQUIRED};
