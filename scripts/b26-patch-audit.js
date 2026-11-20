'use strict';
const fs=require('fs'),path=require('path');
const target=path.resolve(__dirname,'../backend/middleware/clinicalAudit.js');
const marker='// B26_DURABLE_AUDIT_V1';
function patch(s){
  if(s.includes(marker)) return {content:s,already:true};
  const anchor='const { randomUUID } = require("node:crypto");';
  const replacement=`${anchor}\n${marker}\nconst { persistAuditEvent } = require('../services/durableClinicalAudit');`;
  if(s.split(anchor).length!==2)throw Error('SAFETY STOP: missing/duplicate audit require anchor');
  const match=/if \(e\) console\.info\(JSON\.stringify\(e\)\);/g;
  if([...s.matchAll(match)].length!==1)throw Error('SAFETY STOP: expected audit finish anchor missing or repeated');
  s=s.replace(anchor,replacement).replace(match,`if (e) {\n      console.info(JSON.stringify(e));\n      persistAuditEvent(e).catch(err => {\n        console.error('B26 durable audit persistence failed:', err.code || 'DB_ERROR');\n      });\n    }`);
  return {content:s,already:false};
}
function main(){const mode=process.argv[2];if(!['--check','--apply'].includes(mode)||process.argv.length!==3)throw Error('Usage: node scripts/b26-patch-audit.js --check|--apply');const old=fs.readFileSync(target,'utf8');const out=patch(old);if(mode==='--apply'&&!out.already)fs.writeFileSync(target,out.content);console.log(mode==='--check'?'B26_PATCH_PREFLIGHT_OK':out.already?'B26_PATCH_ALREADY_APPLIED':'B26_PATCH_APPLIED');}
if(require.main===module){try{main()}catch(e){console.error(e.message);process.exitCode=1}}
module.exports={patch};
