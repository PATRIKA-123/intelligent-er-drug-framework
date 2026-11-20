'use strict';
const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');
const file=p=>path.join(root,p);const read=p=>fs.readFileSync(file(p),'utf8');
function unique(text,needle,label){if(text.split(needle).length!==2)throw Error(`${label}: expected one source anchor`)}
function patchServer(text){
 if(text.includes('ROUND2_C_ROUTES'))return text;
 const a='app.use("/api/stays", staysRoutes);';unique(text,a,'server');
 return text.replace(a,`// ROUND2_C_ROUTES: scoped board before standard stay routes.
app.use("/api/stays", require("./routes/round2Board"));
app.use("/api/stays", require("./routes/round2Vitals").router);
app.use("/api/stays", require("./routes/round2Departure"));
app.use("/api/post-er", require("./routes/round2PostEr"));
app.use("/api/alerts", require("./routes/round2Alerts"));
${a}`);
}
function patchPostService(text){
 if(text.includes('ROUND2_C_DISCHARGE_ATOMIC'))return text;
 const start=text.indexOf('async function createDischarge('),end=text.indexOf('\nasync function ',start+5);
 if(start<0||end<0)throw Error('createDischarge boundaries changed');
 let part=text.slice(start,end);
 const marker='    await client.query("COMMIT");';unique(part,marker,'discharge commit');
 part=part.replace(marker,`    // ROUND2_C_DISCHARGE_ATOMIC: discharge authorized, not physically departed.
    await client.query("UPDATE ed_stays SET visit_status = 'DISCHARGE_AUTHORIZED' WHERE stay_id = $1 AND visit_status <> 'DEPARTED'",[stayId]);
${marker}`);
 return text.slice(0,start)+part+text.slice(end);
}
function patchPostDisplay(text){
 if(text.includes('ROUND2_C_DEPARTED_AT'))return text;
 const marker='  const followUpsResult = await pool.query(';unique(text,marker,'follow-ups query');
 const inserted=`  // ROUND2_C_DEPARTED_AT: expose actual departure separately from authorization.
  const departureResult = await pool.query('SELECT departed_at FROM ed_stays WHERE stay_id = $1',[stayId]);
  if(dischargeResult.rows[0] && departureResult.rows[0]) dischargeResult.rows[0].departed_at = departureResult.rows[0].departed_at;
`;
 return text.replace(marker,inserted+marker);
}
function patchAll(server,post){return {server:patchServer(server),post:patchPostDisplay(patchPostService(post))};}
function main(){const mode=process.argv[2];if(!['--check','--apply'].includes(mode))throw Error('Usage: node scripts/round2-c-patch.js --check|--apply');
 const files=['backend/server.js','backend/services/postErService.js'];const current=files.map(read);const next=patchAll(...current);if(mode==='--apply'){
  fs.writeFileSync(file(files[0]),next.server);fs.writeFileSync(file(files[1]),next.post);
  console.log('ROUND2_C_PATCH_APPLIED');
 }else console.log('ROUND2_C_PREFLIGHT_OK');}
if(require.main===module)try{main()}catch(e){console.error('SAFETY STOP:',e.message);process.exitCode=1}
module.exports={patchAll,patchServer,patchPostService,patchPostDisplay};
