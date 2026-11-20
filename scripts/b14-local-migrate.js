'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
require(path.join(root,'backend/node_modules/dotenv')).config({path:path.resolve(process.env.PRE_ER_TEST_ENV_FILE||path.join(root,'.env')),override:false});
const {Client}=require(path.join(root,'backend/node_modules/pg'));
const migration='20261120_006_b14_mapping_provenance.sql';
function preflight(e){
 const host=String(e.DB_HOST||'').toLowerCase();
 if(e.DB_NAME!=='intelligent_er_drug_test'||e.PRE_ER_TEST_DATABASE_NAME!==e.DB_NAME||e.B14_CONFIRM_LOCAL_TEST!==e.DB_NAME||!['localhost','127.0.0.1','::1'].includes(host)||e.DB_SSL==='true'||e.NODE_ENV==='production'||!e.DB_USER||!e.DB_PASSWORD)throw Error('SAFETY STOP: require explicit local intelligent_er_drug_test and B14_CONFIRM_LOCAL_TEST, plaintext connection, non-production');
}
function isVerifiedLocalEndpoint(row){
 return row?.db==='intelligent_er_drug_test' && row.loopback===true;
}
async function run(){const arg=process.argv.slice(2);if(arg.length!==1||!['--apply','--verify'].includes(arg[0]))throw Error('Usage: --verify|--apply');
 preflight(process.env);
 const sql=fs.readFileSync(path.join(root,'migrations',migration),'utf8');const hash=crypto.createHash('sha256').update(sql).digest('hex');
 const client=new Client({host:process.env.DB_HOST,port:process.env.DB_PORT||5432,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:false});
 await client.connect();
 try{
  // The PostgreSQL listener can expose localhost as IPv4, IPv6, or an
  // IPv4-mapped IPv6 address. Verify the address IN POSTGRES using inet ranges;
  // never accept a remote interface or an unverified/null endpoint.
  const actual=(await client.query(`SELECT current_database() AS db,
    inet_server_addr()::text AS server,
    COALESCE(
      inet_server_addr() <<= inet '127.0.0.0/8' OR
      inet_server_addr() <<= inet '::1/128' OR
      inet_server_addr() <<= inet '::ffff:127.0.0.0/104',
      false
    ) AS loopback`)).rows[0];
  if(!isVerifiedLocalEndpoint(actual))throw Error('SAFETY STOP: unexpected database endpoint');
  const ledger=(await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists")).rows[0].exists;
  if(!ledger)throw Error('Expected schema_migrations ledger absent');
  const prev=(await client.query('SELECT sha256 FROM public.schema_migrations WHERE migration_id=$1',[migration])).rows[0];
  if(prev&&prev.sha256!==hash)throw Error('Migration checksum mismatch');
  if(arg[0]==='--verify'){console.log(JSON.stringify({result:'B14_VERIFY',database:actual.db,migration:prev?'APPLIED':'PENDING',checksum_valid:true},null,2));return}
  if(prev){console.log('B14_ALREADY_APPLIED');return}
  await client.query('BEGIN');
  try{await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['b14_mapping_migration']);await client.query(sql);
    await client.query('INSERT INTO public.schema_migrations(migration_id,sha256) VALUES ($1,$2)',[migration,hash]);await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e}
  console.log('B14_LOCAL_MIGRATION_APPLIED');
 }finally{await client.end()}
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={preflight,isVerifiedLocalEndpoint};
