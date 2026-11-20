'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const specs=[
  {file:'backend/routes/postEr.js',transform:patchPostEr},
  {file:'backend/services/postErService.js',transform:patchAssignment},
  {file:'backend/routes/emergencyCases.js',transform:patchCases},
];
function once(s,re,label){const a=[...s.matchAll(re)];if(a.length!==1)throw Error(`SAFETY STOP ${label}: expected 1 anchor, got ${a.length}`);return a[0];}
function patchPostEr(s){
 if(s.includes('ROUND2_T4_ASSIGN'))return s;
 once(s,/"\/:stay_id\/assign-doctor"\s*,\s*requireAdmin\s*,/g,'T4 guard');
 s=s.replace(/("\/:stay_id\/assign-doctor"\s*,\s*)requireAdmin(\s*,)/,'$1requireErStaff$2');
 const anchor=/\s+const assignment = await assignDoctorToStay\(/g;
 const m=once(s,anchor,'T4 assignment call');
 s=s.slice(0,m.index)+`\n      // ROUND2_T4_ASSIGN: strict opt-in for replacement.\n      if (req.body?.replace !== undefined && typeof req.body.replace !== 'boolean') {\n        return res.status(400).json({ error: 'replace must be a boolean' });\n      }\n`+s.slice(m.index);
 once(s,/req\.user\.user_id,\s*notes\s*\);/g,'T4 service args');
 s=s.replace(/req\.user\.user_id,\s*notes\s*\);/,'req.user.user_id,\n        notes,\n        req.body?.replace === true\n      );');
 return s;
}
function patchAssignment(s){
 if(s.includes('ROUND2_T4_REPLACE'))return s;
 once(s,/async function assignDoctorToStay\(stayId, doctorUserId, assignedBy, notes\) \{/g,'T4 signature');
 s=s.replace('async function assignDoctorToStay(stayId, doctorUserId, assignedBy, notes) {','async function assignDoctorToStay(stayId, doctorUserId, assignedBy, notes, replace = false) {');
 const block=/    if \(existing\.rows\.length > 0\) \{\s*const error = new Error\(\s*"An active doctor is already assigned to this stay"\s*\);\s*error\.statusCode = 409;\s*throw error;\s*\}/g;
 once(s,block,'T4 existing assignment policy');
 s=s.replace(block,`    // ROUND2_T4_REPLACE: stay lock above serializes concurrent assignments.\n    if (existing.rows.length > 0) {\n      if (!replace) {\n        const error = new Error('An active doctor is already assigned to this stay');\n        error.statusCode = 409;\n        throw error;\n      }\n      await client.query(\n        \`UPDATE stay_doctor_assignments\n           SET status = 'REPLACED', ended_at = NOW(), replaced_at = NOW(), replaced_by = $2\n           WHERE stay_id = $1 AND status = 'ACTIVE'\`,\n        [stayId, assignedBy]\n      );\n    }`);
 return s;
}
function patchCases(s){
 if(s.includes('ROUND2_T8_CASE_QUEUE'))return s;
 const anchor='// GET /api/emergency-cases/:id';
 once(s,/\/\/ GET \/api\/emergency-cases\/:id/g,'T8 insertion point');
 const route=`// ROUND2_T8_CASE_QUEUE: all counts and rows scoped server-side, not UI-filtered.\nrouter.get('/', authMiddleware, authMiddleware.requireRole('PARAMEDIC','ER_STAFF','ADMIN','DOCTOR'), async (req,res)=>{\n  const allowed=['PRE_ER','ARRIVED_ER','ACTIVE_ER','CLOSED'];\n  const status=req.query.status;\n  if(status!==undefined&&!allowed.includes(status))return res.status(400).json({error:'Invalid case status',code:'BAD_REQUEST'});\n  const digits=(v)=>typeof v==='string'&&/^\\d+$/.test(v)&&Number.isSafeInteger(Number(v));\n  if(req.query.limit!==undefined&&!digits(req.query.limit))return res.status(400).json({error:'Invalid limit',code:'BAD_REQUEST'});\n  if(req.query.offset!==undefined&&!digits(req.query.offset))return res.status(400).json({error:'Invalid offset',code:'BAD_REQUEST'});\n  const limit=req.query.limit===undefined?50:Number(req.query.limit);\n  const offset=req.query.offset===undefined?0:Number(req.query.offset);\n  if(limit<1||limit>100||offset>1000000)return res.status(400).json({error:'Invalid pagination',code:'BAD_REQUEST'});\n  const role=req.user.role;\n  const who=req.user.user_id;\n  try {\n    const filter=\`WHERE ($1::text IS NULL OR c.case_status = $1)\n      AND ( $2::text IN ('ADMIN','ER_STAFF')\n         OR ($2='PARAMEDIC' AND c.created_by=$3)\n         OR ($2='DOCTOR' AND EXISTS (\n           SELECT 1 FROM stay_doctor_assignments a\n           WHERE a.stay_id=c.stay_id AND a.doctor_user_id=$3\n             AND a.status='ACTIVE' AND a.ended_at IS NULL)))\`;\n    const params=[status??null,role,who];\n    const count=await pool.query(\`SELECT COUNT(*)::integer AS total FROM emergency_cases c \${filter}\`,params);\n    const data=await pool.query(\`SELECT c.case_id,c.temporary_case_code,c.case_status,c.stay_id,c.created_at,\n        a.chief_complaint,\n        CASE WHEN n.total_news2_score IS NULL THEN NULL ELSE\n          json_build_object('total_news2_score',n.total_news2_score,'risk_level',n.risk_level) END AS latest_news2,\n        CASE WHEN t.transport_id IS NULL THEN NULL ELSE\n          json_build_object('transport_status',t.transport_status,'ambulance_id',t.ambulance_id,\n                            'destination_hospital',t.destination_hospital) END AS transport\n      FROM emergency_cases c\n      LEFT JOIN LATERAL (SELECT chief_complaint FROM pre_er_assessments\n                        WHERE case_id=c.case_id ORDER BY assessment_time DESC NULLS LAST,assessment_id DESC LIMIT 1) a ON TRUE\n      LEFT JOIN LATERAL (SELECT total_news2_score,risk_level FROM news2_results_real\n                        WHERE stay_id=c.stay_id ORDER BY observation_time DESC NULLS LAST,observation_id DESC LIMIT 1) n ON TRUE\n      LEFT JOIN LATERAL (SELECT transport_id,transport_status,ambulance_id,destination_hospital\n                        FROM ambulance_transports WHERE case_id=c.case_id\n                        ORDER BY created_at DESC NULLS LAST,transport_id DESC LIMIT 1) t ON TRUE\n      \${filter} ORDER BY c.created_at DESC,c.case_id DESC LIMIT $4 OFFSET $5\`, [...params,limit,offset]);\n    return res.status(200).json({count:data.rows.length,total:count.rows[0].total,cases:data.rows});\n  }catch(err){console.error('Case queue failed:',err.code||'DB_ERROR');return res.status(500).json({error:'Failed to list cases',code:'INTERNAL_ERROR'});}\n});\n\n`;
 return s.replace(anchor,route+anchor);
}
function run(mode){if(!['--check','--apply'].includes(mode))throw Error('Usage: node scripts/round2-b1-patch.js [--check|--apply]'); const changed=[];for(const entry of specs){const full=path.join(root,entry.file);const existing=fs.readFileSync(full,'utf8');const next=entry.transform(existing);changed.push({file:entry.file,full,existing,next});} if(mode==='--apply'){for(const e of changed){if(e.next!==e.existing)fs.writeFileSync(e.full,e.next)}}console.log(mode==='--check'?'ROUND2_B1_PREFLIGHT_OK':'ROUND2_B1_PATCH_APPLIED',changed.filter(e=>e.next!==e.existing).map(e=>e.file));}
module.exports={patchPostEr,patchAssignment,patchCases};if(require.main===module){try{run(process.argv[2])}catch(err){console.error(err.message);process.exitCode=1}}
