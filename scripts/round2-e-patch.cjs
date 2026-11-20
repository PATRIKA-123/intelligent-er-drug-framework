#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) { console.error('Usage: node scripts/round2-e-patch.cjs --check|--apply'); process.exit(2); }
const changes = new Map();
function edit(file, fn) {
 const full=path.join(root,file); if(!fs.existsSync(full)) throw new Error(`Missing ${file}; extract from repository root`);
 const before=fs.readFileSync(full,'utf8');
 if(before.includes('ROUND2_E_ADAPTER_V1')) {console.log('ALREADY_PATCHED',file);return;}
 const after=fn(before);if(after===before) throw new Error(`No modifications produced for ${file}`);
 changes.set(file,after);
}
function replace(s,from,to,label){
 // Support both LF and CRLF worktrees. Exact anchors are still required.
 const candidates = [from, from.replace(/\n/g, '\r\n')];
 const distinct = [...new Set(candidates)];
 const matches = distinct.map(anchor => ({anchor, count:s.split(anchor).length-1}));
 const total = matches.reduce((n,m)=>n+m.count,0);
 if(total!==1)throw new Error(`${label}: expected exactly one anchor, found ${total}`);
 const chosen = matches.find(m=>m.count===1).anchor;
 const replacement = chosen.includes('\r\n') ? to.replace(/\n/g,'\r\n') : to;
 return s.replace(chosen,replacement);
}
function span(s,start,end,newText,label){
 // Match the source file's line endings for BOTH anchors. A CRLF file
 // can contain a literal start anchor but not an LF-only end anchor.
 const lineEnding = s.includes('\r\n') ? '\r\n' : '\n';
 const adapt = (anchor) => anchor.replace(/\r?\n/g, lineEnding);
 const from = adapt(start), to = adapt(end);
 const i = s.indexOf(from);
 const j = i < 0 ? -1 : s.indexOf(to, i + from.length);
 if (i < 0 || j < 0 || s.indexOf(from, i + from.length) !== -1 ||
     s.indexOf(to, j + to.length) !== -1) {
   throw new Error(`${label}: anchors changed, refusing modification`);
 }
 return s.slice(0,i) + adapt(newText) + s.slice(j);
}
edit('frontend/src/api/client.js',s=>{
 s=replace(s,'export async function request(path, { method = "GET", body } = {}) {',
 'export async function request(path, { method = "GET", body, extraHeaders = {} } = {}) {','client options');
 s=replace(s,'  if (body !== undefined) headers["Content-Type"] = "application/json";',
 '  if (body !== undefined) headers["Content-Type"] = "application/json";\n  for (const [key, value] of Object.entries(extraHeaders)) {\n    if (key !== "Idempotency-Key") throw new Error("Unsupported request header");\n    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new Error("Invalid idempotency key");\n    headers[key] = value;\n  }','client header allowlist');
 return '// ROUND2_E_ADAPTER_V1\n'+s;
});
edit('frontend/src/api/real.js',s=>{
 s=span(s,'  // The stays list has no latest NEWS2 yet','  // Assigned doctor, follow-ups, prescriptions',
 `  // Board API already returns scoped latest NEWS2 and observation data.\n  listStays: () => request('/stays?limit=100'),\n`, 'board adapter');
 s=replace(s,'import { request, ApiError } from "./client.js";','import { request } from "./client.js";','remove unused ApiError');
 s=replace(s,'  // The server can only create doctors so far; ER staff and paramedic accounts are not supported yet.\n  createStaff: async (role, body) => {\n    if (role === "DOCTOR") return real.createDoctor(body);\n    throw new ApiError(501, "The server cannot create ER staff or paramedic accounts yet.");\n  },',
 `  createStaff: (role, body) => role === 'DOCTOR'\n    ? real.createDoctor(body)\n    : request('/staff', { method: 'POST', body: { ...body, role } }),`, 'staff');
 s=span(s,'  // No endpoint lists these across visits yet;','  // Public (no sign-in):',
 `  listFollowUps: async () => { const r = await request('/post-er/follow-ups'); return r.follow_ups || []; },\n  listPendingReviews: async () => { const r = await request('/post-er/prescriptions?status=PENDING_REVIEW'); return r.prescriptions || []; },\n  registerPatient: (body) => request('/patient/register', { method: 'POST', body }),\n  listMyVisits: async () => {\n    const r = await request('/patient/me');\n    return { ...r, profile: { ...r.profile, share: r.profile?.share ?? r.profile?.share_history,\n      dob: r.profile?.dob ?? r.profile?.date_of_birth }, visits: r.visits || [] };\n  },\n  // The server returns 202 for a pending claim; review is required before visits are visible.\n  claimVisit: (body) => request('/patient/claim-visit', { method: 'POST', body }),\n  listClaimRequests: async () => { const r = await request('/patient/claim-requests'); return r.requests || []; },\n  registerVisit: (caseId, body, idempotencyKey) => {\n    if (!idempotencyKey) throw new Error('An idempotency key is required for visit registration');\n    const patient = { full_name: body.patient_name, date_of_birth: body.dob || undefined,\n      phone: body.phone || undefined, email: body.email || undefined };\n    return request('/stays', { method: 'POST',\n      body: { case_id: Number(caseId), patient, chiefcomplaint: body.chief_complaint,\n        ...(body.doctor_user_id ? { doctor_user_id: Number(body.doctor_user_id) } : {}) },\n      extraHeaders: { 'Idempotency-Key': idempotencyKey } });\n  },\n  listMyHealth: () => request('/patient/health'),\n  addMyHealthItem: (kind, body) => {\n    if (!['allergies', 'medications', 'conditions'].includes(kind)) throw new Error('Unknown health list');\n    const key = kind === 'allergies' ? 'reaction' : kind === 'medications' ? 'dose' : 'note';\n    return request('/patient/' + kind, { method: 'POST', body: { name: body.name, [key]: body[key] ?? body.extra ?? '' } });\n  },\n  removeMyHealthItem: (kind, id) => {\n    if (!['allergies', 'medications', 'conditions'].includes(kind)) throw new Error('Unknown health list');\n    return request('/patient/' + kind + '/' + encodeURIComponent(String(id)), { method: 'DELETE' });\n  },\n  updateMyProfile: (body) => request('/patient/profile', { method: 'PATCH', body }),\n  changeMyPassword: (body) => request('/patient/password', { method: 'POST', body }),\n  newAccessCode: (stayId) => request('/stays/' + encodeURIComponent(String(stayId)) + '/access-code', { method: 'POST', body: {} }),\n  getPatientDetails: (stayId) => request('/stays/' + encodeURIComponent(String(stayId)) + '/patient-details'),\n  updatePatientDetails: (stayId, body) => request('/stays/' + encodeURIComponent(String(stayId)) + '/patient-details', { method: 'PATCH', body }),\n  getPatientHistory: (stayId) => request('/stays/' + encodeURIComponent(String(stayId)) + '/patient-history'),\n  listIdentityReviews: async () => { const r = await request('/admin/identity-reviews'); return r.reviews || []; },\n  reviewIdentity: (reviewId, body) => request('/admin/identity-reviews/' + encodeURIComponent(String(reviewId)) + '/decision', { method: 'POST', body }),\n`, 'unimplemented routes');
 s=span(s,'  // The backend has no "list my cases" endpoint yet,','\n};\n\nfunction normalizeCase',
 `  listCases: async () => {\n    const r = await request('/emergency-cases?limit=100');\n    return { count: r.count ?? (r.cases || []).length, cases: (r.cases || []).map(c => ({\n      ...c, status: c.case_status || c.status,
      latest_assessment: c.chief_complaint ? { chief_complaint: c.chief_complaint } : null,\n      news2: c.latest_news2 ? {complete: true, ...c.latest_news2} : {complete: false},\n      steps: { assessment: Boolean(c.chief_complaint), vitals: Boolean(c.latest_news2),\n        transport: Boolean(c.transport), handover: c.transport?.transport_status === 'HANDOVER_COMPLETE' },\n    })) };\n  },`, 'case list');
 s=s.replace('import { rememberCase, rememberedCases } from "../lib/myCases.js";','import { rememberCase } from "../lib/myCases.js";');
 return '// ROUND2_E_ADAPTER_V1\n'+s;
});
edit('frontend/src/components/RegisterVisit.jsx',s=>{
 s=replace(s,'import { useEffect, useState } from "react";','import { useEffect, useRef, useState } from "react";','reg import');
 s=replace(s,'  const [err, setErr] = useState("");','  const [err, setErr] = useState("");\n  // Keep one key across retries; never duplicate a visit after timeout.\n  const requestKey = useRef(null);','reg key');
 s=replace(s,'      onDone(await api.registerVisit(c.case_id, body));',
 `      requestKey.current ||= crypto.randomUUID();\n      const result = await api.registerVisit(c.case_id, body, requestKey.current);\n      requestKey.current = null;\n      await onDone(result);`,'reg payload');
 s=replace(s,'Give this slip to the patient. They add the visit to their profile with the visit ID, the access code and the last 4 digits of their phone.',
 'Give this slip to the patient. Their access code and phone digits submit a claim for identity verification; the visit is added only after authorized staff approval. Keep this code private.','slip');
 return '// ROUND2_E_ADAPTER_V1\n'+s;
});
edit('frontend/src/pages/AddVisit.jsx',s=>{
 s=replace(s,'  const [err, setErr] = useState("");','  const [err, setErr] = useState("");\n  const [pending, setPending] = useState(false);','claim pending state');
 s=replace(s,'      await api.claimVisit({ stay_id: f.stay_id.trim(), access_code: f.access_code.trim(), phone_last4: f.phone_last4.trim() });\n      navigate("/patient", { replace: true });',
 `      await api.claimVisit({ stay_id: f.stay_id.trim(), access_code: f.access_code.trim(), phone_last4: f.phone_last4.trim() });\n      setPending(true);\n      setF({ stay_id: '', access_code: '', phone_last4: '' });`,'claim success');
 s=replace(s,'  const navigate = useNavigate();','  // Claim submissions are pending verification, not immediately visible visits.','navigate unused');
 s=replace(s,'import { useNavigate } from "react-router";\n','', 'navigate import');
 s=replace(s,'        {err && <p role="alert"',
 `        {pending && <p role="status" className="m-0 rounded-2xl bg-lavender p-4 text-sm">Claim received. Your visit will appear after identity verification by authorized staff. Do not submit the code again.</p>}\n        {err && <p role="alert"`,'pending notice');
 return '// ROUND2_E_ADAPTER_V1\n'+s;
});
edit('frontend/src/pages/PatientHome.jsx',s=>{
 s=replace(s,'v.prescriptions.filter((p) => p.active !== false)','v.prescriptions.filter((p) => p.active === true)','active strict');
 s=replace(s,'      {active.length > 0 && (',
 `      {visits.some(v => v.prescriptions.some(p => p.active == null)) && <p role="status" className="rounded-2xl bg-lavender px-4 py-3 text-sm">Medication activity is not verified for some prescriptions. Ask your clinician before relying on this list.</p>}\n      {active.length > 0 && (`,'unknown notice');
 return '// ROUND2_E_ADAPTER_V1\n'+s;
});
edit('frontend/src/pages/PatientMedicines.jsx',s=>{
 s=replace(s,'  const active = all.filter((p) => p.active !== false);','  const active = all.filter((p) => p.active === true);\n  const unknown = all.filter((p) => p.active == null);','active classification');
 s=replace(s,'      {earlier.length > 0 && (',
 `      {unknown.length > 0 && (\n        <section className="panel p-6!">\n          <h2 className="m-0 mb-3 text-xl font-semibold">Activity not verified</h2>\n          <p className="text-sm text-muted">Do not assume these medicines are currently active. Confirm with your clinician.</p>\n          <ul className="m-0 flex flex-col gap-2 p-0 list-none">{unknown.map(p => <Rx key={p.prescription_id} p={p} />)}</ul>\n        </section>\n      )}\n      {earlier.length > 0 && (`,'unknown section');
 return '// ROUND2_E_ADAPTER_V1\n'+s;
});
edit('frontend/src/pages/ParamedicHome.jsx',s=>{
 s=replace(s,'Cases you started or opened on this device.','Cases available to your account.','case description');
 return '// ROUND2_E_ADAPTER_V1\n'+s;
});
edit('frontend/src/pages/PatientProfile.jsx',s=>{
 s=replace(s,'emergency_contact: { name: f.ec_name, phone: f.ec_phone }','emergency_contact: f.ec_name.trim() || f.ec_phone.trim() ? { name: f.ec_name, phone: f.ec_phone } : null','empty contact');
 return '// ROUND2_E_ADAPTER_V1\n'+s;
});
console.log('ROUND2_E_PREFLIGHT_OK', [...changes.keys()]);
if(mode==='--apply'){for(const [file,content] of changes){fs.writeFileSync(path.join(root,file),content,'utf8');}console.log('ROUND2_E_PATCH_APPLIED');}
