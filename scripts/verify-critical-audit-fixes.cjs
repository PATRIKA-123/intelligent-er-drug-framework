'use strict';
// Focused backend regression checks with a stub database. No Neon calls, no patient data.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
let permissionGranted = false;
let dbWrites = 0;
const pool = {
  async query(sql) {
    if (sql.includes('user_clinical_permissions')) return {rowCount:permissionGranted?1:0,rows:permissionGranted?[{ok:1}]:[]};
    if (sql.includes('FROM public.ed_stays')) return {rowCount:1,rows:[{stay_id:42}]};
    throw new Error('Unexpected pool query: '+sql.slice(0,150));
  },
  async connect() {
    return {
      async query(sql) {
        if (/^INSERT INTO public\.er_vital_entries/.test(sql)) {dbWrites++;return {rowCount:1,rows:[{entry_id:101}]};}
        if (/SELECT stay_id FROM ed_stays/.test(sql)) return {rowCount:1,rows:[{stay_id:42}]};
        return {rowCount:1,rows:[]};
      },
      release(){}
    };
  }
};
let vitalPost;
const expressStub = { Router() { return {post(_path,...handlers){vitalPost=handlers.at(-1);}}; } };
const fakeAuth = Object.assign((req,res,next)=>next(),{requireRole:()=>((req,res,next)=>next())});
Module._load = function(request,parent,isMain){
  const p=parent?.filename||'';
  if(p.includes(`${path.sep}backend${path.sep}`) && request==='../db')return pool;
  if(p.endsWith(`${path.sep}round2Vitals.js`) && request==='express')return expressStub;
  if(p.endsWith(`${path.sep}round2Vitals.js`) && request==='../middleware/authMiddleware')return fakeAuth;
  if(p.endsWith(`${path.sep}round2Vitals.js`) && request==='../services/accessPolicy')return {requireStayAccess:()=>((req,res,next)=>next())};
  if(p.endsWith(`${path.sep}accessPolicy.js`) && request==='./schemaCapabilities')return {hasColumn:async()=>true};
  return originalLoad.apply(this,arguments);
};
let access, vitals;
try {
  access=require(path.join(root,'backend/services/accessPolicy.js'));
  vitals=require(path.join(root,'backend/routes/round2Vitals.js'));
} finally {Module._load=originalLoad;}
async function check(){
  assert.equal(await access.canAccessStay({role:'ER_STAFF',user_id:7},42),true,'ER staff can access walk-in stay');
  const filtered=await access.stayListFilter({role:'ER_STAFF',user_id:7});
  assert.equal(filtered.clause,'TRUE'); assert.deepEqual(filtered.params,[]);
  const body={heart_rate:75,respiratory_rate:19,systolic_bp:120,spo2:94,temperature_celsius:37,
    consciousness:'ALERT',oxygen_support:true,spo2_scale:2,scale2_clinician_authorized:true};
  assert.throws(()=>vitals.parseBody(body),/authorization/i,'client bool cannot authorize scale 2');
  assert.equal(vitals.parseBody(body,true).complete,true,'verified clinician permission enables scale 2');
  async function request(role){
    let status=200,result;
    const res={status(code){status=code;return this;},json(payload){result=payload;return this;}};
    await vitalPost({params:{stay_id:'42'},user:{role,user_id:7},body},res);
    return {status,result};
  }
  assert.equal((await request('ER_STAFF')).status,403);
  assert.equal(dbWrites,0,'unauthorized never writes vitals');
  assert.equal((await request('DOCTOR')).status,403);
  assert.equal(dbWrites,0);
  permissionGranted=true;
  assert.equal((await request('DOCTOR')).status,201);
  assert.equal(dbWrites,1);
  console.log('PASS: patient access scope, walk-in board, Scale 2 authorization gate and no unauthorized writes');
}
check().catch(e=>{console.error(e);process.exitCode=1;});
