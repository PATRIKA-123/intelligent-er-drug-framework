'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const id='20261120_007_clinical_audit_events';
const sql=fs.readFileSync(path.join(root,'migrations',id+'.sql'),'utf8');
const sha=crypto.createHash('sha256').update(sql).digest('hex');
function localHost(host){
  if(typeof host !== 'string') return false;
  const address=host.trim().toLowerCase();
  if(address==='localhost') return true;
  const withoutMask=address.split('/')[0];
  const {isIP}=require('node:net');
  if(isIP(withoutMask)===4) return withoutMask.split('.')[0]==='127';
  if(isIP(withoutMask)!==6) return false;
  if(withoutMask==='::1'||withoutMask==='0:0:0:0:0:0:0:1') return true;
  // Node accepts valid IPv4-mapped IPv6 addresses with either IPv4 or hex suffix.
  const mapped=withoutMask.match(/^::ffff:(.+)$/);
  if(!mapped) return false;
  let ipv4=mapped[1];
  if(isIP(ipv4)===4) return ipv4.split('.')[0]==='127';
  if(/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ipv4)){
    const pieces=ipv4.split(':').map(x=>parseInt(x,16));
    return (pieces[0]>>8)===127;
  }
  return false;
}
function preflight(e){const issues=[];if(!localHost(e.DB_HOST))issues.push('local DB_HOST required');if(e.DB_NAME!=='intelligent_er_drug_test'||e.PRE_ER_TEST_DATABASE_NAME!==e.DB_NAME)issues.push('unexpected DB_NAME');if(e.NODE_ENV==='production'||e.DB_SSL==='true')issues.push('production/SSL forbidden');if(e.B26_CONFIRM_LOCAL_TEST!=='intelligent_er_drug_test')issues.push('B26_CONFIRM_LOCAL_TEST required');return issues}
async function run(){require(path.join(root,'backend/node_modules/dotenv')).config({path:path.resolve(process.env.PRE_ER_TEST_ENV_FILE || path.join(root,'backend/.env.pre-er-test')),override:false});const {Client}=require(path.join(root,'backend/node_modules/pg'));const mode=process.argv[2];if(!['--verify','--apply'].includes(mode)||process.argv.length!==3)throw Error('Usage: --verify|--apply');let errors=preflight(process.env);if(errors.length)throw Error('SAFETY STOP: '+errors.join(', '));const c=new Client({host:process.env.DB_HOST,port:process.env.DB_PORT||5432,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:false});await c.connect();try{const r=(await c.query('SELECT current_database() AS db, inet_server_addr()::text AS address')).rows[0];if(r.db!=='intelligent_er_drug_test'||!localHost(r.address))throw Error('SAFETY STOP: unexpected server endpoint');const table=(await c.query("SELECT to_regclass('public.clinical_audit_events')::text AS t")).rows[0].t;const ledger=(await c.query("SELECT to_regclass('public.schema_migrations')::text AS t")).rows[0].t;if(!ledger)throw Error('Missing schema_migrations; apply B04/B10 first');const record=(await c.query('SELECT sha256 FROM public.schema_migrations WHERE migration_id=$1',[id])).rows[0];if(record&&record.sha256!==sha)throw Error('SAFETY STOP: migration checksum mismatch');if(mode==='--verify'){console.log(JSON.stringify({result:'B26_VERIFY',database:r.db,migration:record?'APPLIED':'PENDING',checksum_valid:!record||record.sha256===sha,table_exists:!!table},null,2));return}if(record){console.log('B26_ALREADY_APPLIED');return}if(table)throw Error('SAFETY STOP: table exists without migration record');await c.query('BEGIN');try{await c.query(sql);await c.query('INSERT INTO public.schema_migrations(migration_id,sha256) VALUES($1,$2)',[id,sha]);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}console.log('B26_LOCAL_MIGRATION_APPLIED')}finally{await c.end()}}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1});module.exports={preflight,localHost};
