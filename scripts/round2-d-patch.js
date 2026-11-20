'use strict';
// Guarded, idempotent append-only router mounts. Does not overwrite preexisting routes.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=path.join(root,'backend','server.js');
const original=fs.readFileSync(file,'utf8');
const imports=`const round2PatientRoutes = require('./routes/round2Patient');
const round2IdentityRoutes = require('./routes/round2Identity');
`;
const mounts=`app.use('/api/patient', round2PatientRoutes);
app.use('/api/stays', round2IdentityRoutes.stayRouter);
app.use('/api/admin', round2IdentityRoutes.adminRouter);
`;
const required=[
 'const staysRoutes = require("./routes/stays");',
 'app.use("/api/stays", staysRoutes);'
];
for(const anchor of required)assert(original.includes(anchor),`Unexpected server source; missing ${anchor}`);
let updated=original;
if(!updated.includes("require('./routes/round2Patient')")) updated=updated.replace(required[0],imports+required[0]);
if(!updated.includes("app.use('/api/patient', round2PatientRoutes);"))updated=updated.replace(required[1],mounts+required[1]);
const mode=process.argv[2];
if(mode==='--check')console.log('ROUND2_D_PREFLIGHT_OK',updated===original?'ALREADY_APPLIED':'PATCH_READY');
else if(mode==='--apply'){if(updated!==original)fs.writeFileSync(file,updated);console.log('ROUND2_D_PATCH_APPLIED');}
else {console.error('Usage: node scripts/round2-d-patch.js --check|--apply');process.exitCode=2;}
