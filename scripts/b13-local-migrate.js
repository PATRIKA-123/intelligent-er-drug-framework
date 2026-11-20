#!/usr/bin/env node
"use strict";
const path=require("node:path"),fs=require("node:fs"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"..");
const {createRequire}=require("node:module");

const filename="20261120_005_screening_runs.sql", migrationId="20261120_005_screening_runs";
function local(a){return ["localhost","127.0.0.1","::1","::ffff:127.0.0.1"].includes(String(a||"").trim().replace(/\/\d+$/,"").replace(/^\[|\]$/g,"").toLowerCase())}
function safety(e,apply){let errors=[];
 if(e.DB_NAME!=="intelligent_er_drug_test"||e.PRE_ER_TEST_DATABASE_NAME!==e.DB_NAME)errors.push("wrong disposable test database");
 if(!local(e.DB_HOST)||!([undefined,null,"","false","0"].includes(e.DB_SSL))||e.NODE_ENV==="production")errors.push("remote/SSL/production not allowed");
 if(!e.DB_PASSWORD||!e.DB_USER)errors.push("missing database credentials");
 if(apply&&e.B13_CONFIRM_LOCAL_TEST!==e.DB_NAME)errors.push("set B13_CONFIRM_LOCAL_TEST to exact target database");
 return errors;
}
async function run(){
 const backendRequire=createRequire(path.join(root,"backend/package.json"));
 backendRequire("dotenv").config({path:path.resolve(process.env.PRE_ER_TEST_ENV_FILE||path.join(root,"backend/.env.pre-er-test")),override:true});
 const {Client}=backendRequire("pg");
 const flags=process.argv.slice(2);if(flags.length!==1||!["--apply","--verify"].includes(flags[0]))throw Error("Use --verify or --apply");
 const apply=flags[0]==="--apply";
 const problems=safety(process.env,apply);if(problems.length)throw Error("SAFETY STOP: "+problems.join("; ")+" [diagnostic: db="+String(process.env.DB_NAME||"<unset>")+", host="+String(process.env.DB_HOST||"<unset>")+", ssl="+String(process.env.DB_SSL??"<unset>")+", node_env="+String(process.env.NODE_ENV||"<unset>")+", test_name_matches="+(process.env.PRE_ER_TEST_DATABASE_NAME===process.env.DB_NAME)+"]");
 const sql=fs.readFileSync(path.join(root,"migrations",filename),"utf8");
 const checksum=crypto.createHash("sha256").update(sql).digest("hex");
 const db=new Client({host:process.env.DB_HOST,port:process.env.DB_PORT||5432,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:false});
 try{
 await db.connect();
 const current=(await db.query("SELECT current_database() name, inet_server_addr()::text address, current_setting('server_version_num')::int version")).rows[0];
 if(current.name!=="intelligent_er_drug_test"||!local(current.address)||current.version<180000)throw Error("SAFETY STOP: unexpected PostgreSQL database/server");
 const ledger=(await db.query("SELECT to_regclass('public.schema_migrations')::text AS table_name")).rows[0].table_name;
 if(!ledger)throw Error("schema_migrations missing; complete B04 migration ledger first");
 const record=(await db.query("SELECT sha256 FROM public.schema_migrations WHERE migration_id=$1",[migrationId])).rows[0];
 if(record&&record.sha256!==checksum)throw Error("Migration checksum mismatch. STOP; do not overwrite ledger");
 if(!apply){
  const tables=(await db.query("SELECT to_regclass('public.screening_runs')::text AS t")).rows[0].t;
  const count=tables?Number((await db.query("SELECT count(*)::int n FROM public.screening_runs")).rows[0].n):null;
  if(Boolean(record)!==Boolean(tables))throw Error("Migration ledger/table mismatch");
  console.log(JSON.stringify({mode:"VERIFY_READ_ONLY",database:current.name,migration:record?"ALREADY_RECORDED":"PENDING",checksum_valid:!record||record.sha256===checksum,screening_runs:count},null,2));
  return;
 }
 await db.query("BEGIN");
 try {
  // Hold an advisory lock to serialize competing B13 migration runners.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('B13_SCHEMA_MIGRATION',0))");
  const latest=(await db.query("SELECT sha256 FROM public.schema_migrations WHERE migration_id=$1 FOR UPDATE",[migrationId])).rows[0];
  if(latest&&latest.sha256!==checksum)throw Error("Migration checksum mismatch");
  if(!latest){await db.query(sql);await db.query("INSERT INTO public.schema_migrations(migration_id,sha256) VALUES($1,$2)",[migrationId,checksum]);}
  await db.query("COMMIT");
 }catch(err){await db.query("ROLLBACK");throw err;}
 const tables=(await db.query("SELECT to_regclass('public.screening_runs')::text AS t")).rows[0].t;
 if(!tables)throw Error("B13 migration did not create screening_runs");
 console.log(JSON.stringify({result:"B13_LOCAL_MIGRATION_APPLIED",database:current.name,checksum_valid:true},null,2));
 }finally{await db.end().catch(()=>{})}
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={safety,local};
