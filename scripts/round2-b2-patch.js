"use strict";
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const server=path.join(root,'backend/server.js');const pre=path.join(root,'backend/routes/preEr.js');const security=path.join(root,'backend/config/httpSecurity.js');
function unique(src,s,description){if(src.split(s).length!==2)throw Error(description+' anchor changed or missing');}
function patchServer(src){
 if(src.includes('ROUND2_B2_ROUTES')) return src;
 const anchor='app.use("/api/stays", staysRoutes);';unique(src,anchor,'server routes');
 const changed=`// ROUND2_B2_ROUTES: registration before read-only stays, patient directory as separate route.\napp.use("/api/patients", require("./routes/patients"));\napp.use("/api/stays", require("./routes/visitRegistration"));\n${anchor}`;
 return src.replace(anchor,changed);
}
function patchPre(src){
 if(src.includes('ROUND2_B2_SHARED_LINK')) return src;
 const start='      const caseResult = await client.query(';const at=src.indexOf('"/:id/er-arrival"');
 if(at<0)throw Error('Missing ER arrival');const x=src.indexOf(start,at);
 const end='      await client.query("COMMIT");';const z=src.indexOf(end,x);
 if(x<0||z<0||z-x>8500)throw Error('ER-arrival transaction changed');
 const body=src.slice(x,z);
 for(const marker of ['FROM emergency_cases','FROM ed_stays','UPDATE emergency_cases','UPDATE ambulance_transports'])if(!body.includes(marker))throw Error('Missing link logic '+marker);
 let updated=src.slice(0,x)+`      // ROUND2_B2_SHARED_LINK: one transactional linking policy for both routes.\n      linkedCase = await require('../services/round2Registration').linkCaseToStay(client,caseId,stayId);\n\n`+src.slice(z);
 const catchAnchor='      // Two requests tried to link different cases to the same stay at the same';
 unique(updated,catchAnchor,'ER-arrival errors');
 updated=updated.replace(catchAnchor,`      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });\n\n${catchAnchor}`);
 // Once linkage commits, failures must not appear to invalidate the linked visit.
 const section=updated.indexOf('// POST /api/emergency-cases/:id/er-arrival');
 const endRoute=updated.indexOf('\n);',section);
 if(endRoute<0)throw Error('ER arrival route end missing');
 const chunk=updated.slice(section,endRoute);
 const adapted=chunk.replace(/return res\.status\(500\)\.json\(\{/g,'return res.status(202).json({');
 updated=updated.slice(0,section)+adapted+updated.slice(endRoute);
 return updated;
}
function patchSecurity(src){
 if(src.includes('"Idempotency-Key"'))return src;
 const old='const ALLOWED_HEADERS = ["Authorization", "Content-Type"];';
 unique(src,old,'CORS allowed headers');
 return src.replace(old,'const ALLOWED_HEADERS = ["Authorization", "Content-Type", "Idempotency-Key"];');
}
function main(){const arg=process.argv[2];if(!['--check','--apply'].includes(arg))throw Error('Usage: node scripts/round2-b2-patch.js --check|--apply');
 const a=fs.readFileSync(server,'utf8'),b=fs.readFileSync(pre,'utf8'),c=fs.readFileSync(security,'utf8');const nextA=patchServer(a),nextB=patchPre(b),nextC=patchSecurity(c);
 if(arg==='--apply'){fs.writeFileSync(server,nextA);fs.writeFileSync(pre,nextB);fs.writeFileSync(security,nextC);console.log('ROUND2_B2_PATCH_APPLIED');}
 else console.log('ROUND2_B2_PREFLIGHT_OK');}
if(require.main===module){try{main();}catch(e){console.error('SAFETY STOP:',e.message);process.exitCode=1;}}
module.exports={patchServer,patchPre,patchSecurity};
