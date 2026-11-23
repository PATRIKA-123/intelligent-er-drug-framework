/* Parvah frontend lint refactor. Run locally from repo root after extracting ZIP.
 * Makes explicit-source transformations; fails before writing if a known source
 * differs from the reviewed frontendfix version. No network or DB operations.
 */
'use strict';
const fs=require('node:fs');const path=require('node:path');
const repo=path.resolve(__dirname,'..');const pending=new Map();const skipped=[];
function read(rel){const full=path.join(repo,rel);if(pending.has(rel))return pending.get(rel);if(!fs.existsSync(full))throw Error('Missing '+rel);return fs.readFileSync(full,'utf8').replace(/\r\n/g,'\n')}
function store(rel,s){pending.set(rel,s)}
function swap(rel,oldText,newText){let s=read(rel);if(!s.includes(oldText)){if(s.includes(newText.slice(0,90))){skipped.push(rel);return;}throw Error('Unexpected source in '+rel+': '+oldText.slice(0,120));}store(rel,s.replace(oldText,newText))}
const dir='frontend/src/';
function loadEffect(rel,call,success,failed){const s=read(dir+rel);const original='useEffect(load, []);';
 if(!s.includes(original))throw Error('Expected initial data loading effect in '+rel);
 const effect=`useEffect(() => {\n    let live = true;\n    ${call}.then(${success}).catch(${failed});\n    return () => { live = false; };\n  }, []);`;
 store(dir+rel,s.replace(original,effect));}
// 1. Patient pages: initial fetches do not redundantly set loading=true inside useEffect.
loadEffect('pages/PatientHome.jsx','api.listMyVisits()','data => { if (live) setSt({ loading: false, error: null, data }); }','error => { if (live) setSt({ loading: false, error, data: null }); }');
loadEffect('pages/PatientMedicines.jsx','Promise.all([api.listMyVisits(), api.listMyHealth()])','([v, h]) => { if (live) { setMine(h.medications); setSt({ loading: false, error: null, visits: v.visits }); } }','error => { if (live) setSt({ loading: false, error, visits: [] }); }');
loadEffect('pages/PatientProfile.jsx','api.listMyVisits()','d => { if (!live) return; const p = d.profile; setF({ full_name: p.full_name, dob: p.dob, phone: p.phone, email: p.email || "", share: p.share !== false, ec_name: p.emergency_contact?.name || "", ec_phone: p.emergency_contact?.phone || "" }); setSt({ loading: false, error: null }); }','error => { if (live) setSt({ loading: false, error }); }');
// 2. Paramedic home and ER board retain an explicit reload() for retry/refresh.
for (const [rel,method,result] of [
 ['pages/ParamedicHome.jsx','api.listCases()','cases: d.cases || []'],
 ['pages/Board.jsx','getStays(false)','stays: d.stays || []']]){
 const full=dir+rel,s=read(full),old='useEffect(load, [load]);';
 if(!s.includes(old))throw Error('Expected load effect '+rel);
 const effect=`useEffect(() => {\n    let live = true;\n    ${method}.then(d => { if (live) setState({ loading: false, error: null, ${result} }); })\n      .catch(error => { if (live) setState({ loading: false, error, ${rel.includes('Board')?'stays':'cases'}: [] }); });\n    return () => { live = false; };\n  }, []);`;
 store(full,s.replace(old,effect));
}
// 3. Stay detail: initial fetch cancels response on navigation, reload remains available.
{
 const full=dir+'pages/StayDetail.jsx',s=read(full),old='useEffect(load, [load]);';
 if(!s.includes(old))throw Error('StayDetail source changed');
 store(full,s.replace(old,`useEffect(() => {\n    let live = true;\n    Promise.all([api.getStaySummary(stayId), api.getObservations(stayId)])\n      .then(([summary, o]) => { if (live) setState({ loading: false, error: null, summary, obs: o.observations || [] }); })\n      .catch(error => { if (live) setState({ loading: false, error, summary: null, obs: [] }); });\n    return () => { live = false; };\n  }, [stayId]);`));
}
// 4. Discharge: no extra re-render on mount, explicit retry untouched.
{
 const full=dir+'pages/Discharge.jsx',s=read(full),old='useEffect(load, [stayId]);';
 if(!s.includes(old))throw Error('Discharge source changed');
 store(full,s.replace(old,`useEffect(() => {\n    let live = true;\n    Promise.all([api.getStaySummary(stayId), api.getPostEr(stayId)])\n      .then(([summary, post]) => { if (live) setState({ loading: false, error: null, summary, post }); })\n      .catch(error => { if (live) setState({ loading: false, error, summary: null, post: null }); });\n    return () => { live = false; };\n  }, [stayId]);`));
}
// 5. Invitation: derive invalid-token UI without putting a synchronous state update in the effect.
{
 const full=dir+'pages/AcceptInvitation.jsx';let s=read(full);
 const old=`  useEffect(() => {\n    if (!/^[a-f0-9]{64}$/i.test(token)) {\n      setState({ phase: "bad", name: "", error: "This invitation link is incomplete. Open the link from your email again." });\n      return;\n    }\n    api.validateInvitation(token)\n      .then((r) => setState({ phase: "ready", name: r.doctor_name || "", error: "" }))\n      .catch((e) => setState({ phase: "bad", name: "", error: e.message }));\n  }, [token]);`;
 const next=`  const validToken = /^[a-f0-9]{64}$/i.test(token);\n  const currentPhase = validToken ? state.phase : "bad";\n  useEffect(() => {\n    if (!validToken) return;\n    let live = true;\n    api.validateInvitation(token)\n      .then(r => { if (live) setState({ phase: "ready", name: r.doctor_name || "", error: "" }); })\n      .catch(e => { if (live) setState({ phase: "bad", name: "", error: e.message }); });\n    return () => { live = false; };\n  }, [token, validToken]);`;
 if(!s.includes(old))throw Error('AcceptInvitation source changed');
 s=s.replace(old,next).replaceAll('state.phase === "checking"','currentPhase === "checking"').replaceAll('state.phase === "bad"','currentPhase === "bad"').replaceAll('state.phase === "ready"','currentPhase === "ready"').replaceAll('state.phase === "done"','currentPhase === "done"');
 s=s.replace('{state.error}</p>', '{validToken ? state.error : "This invitation link is incomplete. Open the link from your email again."}</p>');store(full,s);
}
// 6. FollowUps: state reset on stay switch is handled by a keyed child instance,
// instead of calling setForm/setMsg in a loading effect.
{
 const full=dir+'components/FollowUps.jsx';let s=read(full);
 const old='export default function FollowUps({ stayId, canAdd }) {';
 const next=`export default function FollowUps({ stayId, canAdd }) {\n  return <FollowUpsContent key={stayId} stayId={stayId} canAdd={canAdd} />;\n}\nfunction FollowUpsContent({ stayId, canAdd }) {`;
 if(!s.includes(old))throw Error('FollowUps component changed');s=s.replace(old,next);
 const oldEff='useEffect(() => { setForm(EMPTY); setMsg(null); load(); }, [load]);';
 const newEff=`useEffect(() => {\n    let live = true;\n    api.getPostEr(stayId)\n      .then(data => { if (live) setState({ loading: false, error: null, data }); })\n      .catch(error => { if (live) setState({ loading: false, error, data: null }); });\n    return () => { live = false; };\n  }, [stayId]);`;
 if(!s.includes(oldEff))throw Error('FollowUps effect changed');store(full,s.replace(oldEff,newEff));
}
// 7. Paramedic case: derive first unfinished panel during render, without effect-driven state initialization.
{
 const full=dir+'pages/ParamedicCase.jsx';let s=read(full);
 const old=`  useEffect(() => {\n    setState((s) => ({ ...s, loading: true, error: null }));\n    load();\n  }, [load]);`;
 const next=`  useEffect(() => {\n    let live = true;\n    api.getCase(caseId)\n      .then(c => { if (live) setState({ loading: false, error: null, c }); })\n      .catch(error => { if (live) setState({ loading: false, error, c: null }); });\n    return () => { live = false; };\n  }, [caseId]);`;
 if(!s.includes(old))throw Error('ParamedicCase loading effect changed');s=s.replace(old,next);
 const old2='useEffect(() => { if (firstTodo) setOpen((o) => (Object.keys(o).length ? o : { [firstTodo]: true })); }, [firstTodo]);';
 if(!s.includes(old2))throw Error('ParamedicCase firstTodo effect changed');
 s=s.replace(old2,'const effectiveOpen = Object.keys(open).length ? open : firstTodo ? { [firstTodo]: true } : {};');
 // 'open' is a state variable, used in JSX only as boolean panel state; toggle should operate on effectiveOpen.
 for(const name of ['assessment','vitals','transport','arrive'])s=s.replace('open={!!open.'+name+'}', 'open={!!effectiveOpen.'+name+'}');
 s=s.replace('const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));','const toggle = (k) => setOpen((o) => { const current=Object.keys(o).length?o:effectiveOpen; return {...current,[k]:!current[k]}; });');
 store(full,s);
}
// 8. Right panel: the helper receives a primitive key, not an opaque dependency array.
{
 const full=dir+'components/RightPanel.jsx';let s=read(full);
 const old=`function useLoad(fn, deps) {\n  const [st, setSt] = useState({ loading: true, error: null, data: null });\n  useEffect(() => {\n    let live = true;\n    setSt({ loading: true, error: null, data: null });\n    fn().then((data) => live && setSt({ loading: false, error: null, data }))\n      .catch((error) => live && setSt({ loading: false, error, data: null }));\n    return () => { live = false; };\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, deps);\n  return st;\n}`;
 const next=`function useLoad(fetcher, key) {\n  const [st, setSt] = useState({ loading: true, error: null, data: null });\n  useEffect(() => {\n    let live = true;\n    fetcher(key).then(data => { if (live) setSt({ loading: false, error: null, data }); })\n      .catch(error => { if (live) setSt({ loading: false, error, data: null }); });\n    return () => { live = false; };\n  }, [fetcher, key]);\n  return st;\n}`;
 if(!s.includes(old))throw Error('RightPanel useLoad changed');s=s.replace(old,next);
 s=s.replace('function useLoad(fetcher, key) {',`const fetchPostEr = (id) => api.getPostEr(id);\nconst fetchGetPatientHistory = (id) => api.getPatientHistory(id);\nconst fetchListFollowUps = () => api.listFollowUps();\nconst fetchListPendingReviews = () => api.listPendingReviews();\nconst fetchListDoctors = () => api.listDoctors();\nconst fetchListMyVisits = () => api.listMyVisits();\nfunction useLoad(fetcher, key) {`);
 s=s.replaceAll('useLoad(() => api.getPostEr(stayId), [stayId])','useLoad(fetchPostEr, stayId)');
 s=s.replaceAll('useLoad(() => api.getPatientHistory(stayId), [stayId])','useLoad(fetchGetPatientHistory, stayId)');
 s=s.replaceAll('useLoad(() => api.listFollowUps(), [])','useLoad(fetchListFollowUps, null)');
 s=s.replaceAll('useLoad(() => api.listPendingReviews(), [])','useLoad(fetchListPendingReviews, null)');
 s=s.replaceAll('useLoad(() => api.listDoctors(), [])','useLoad(fetchListDoctors, null)');
 s=s.replaceAll('useLoad(() => api.listMyVisits(), [])','useLoad(fetchListMyVisits, null)');
 s=s.replace('<VisitCard visit={visit} />','<VisitCard key={visit.stayId} visit={visit} />');
 s=s.replace('<HistoryCard stayId={visit.stayId} />','<HistoryCard key={visit.stayId} stayId={visit.stayId} />');
 // Detect any unconverted callers before writing.
 const remaining=[...s.matchAll(/useLoad\([^\n]*,\s*\[/g)];if(remaining.length)throw Error('Unconverted useLoad call sites');
 store(full,s);
}

// 9. Split hooks and constants from component modules to enable reliable Fast Refresh.
//    Update their imports across the entire frontend together, as one atomic refactor.
{
 const rel=dir+'components/CaseNav.jsx',original=read(rel);
 const pivot=original.indexOf('export function useCaseNav()');
 const ctx='const Ctx = createContext({ nav: null, setNav: () => {}, visit: null, setVisit: () => {} });';
 if(pivot<0||!original.includes(ctx))throw Error('CaseNav source changed');
 const hookAndDefs=original.slice(pivot);
 store(dir+'lib/caseNavHooks.js',`import { useContext, useEffect } from 'react';\nimport { Ctx } from '../components/CaseNavContext';\n\n${hookAndDefs}`);
 store(dir+'components/CaseNavContext.js',`import { createContext } from 'react';\nexport const Ctx = createContext({ nav: null, setNav: () => {}, visit: null, setVisit: () => {} });\n`);
 let provider=original.slice(0,pivot).replace('createContext, useContext, useEffect, ', '').replace(ctx,"import { Ctx } from './CaseNavContext';");
 store(rel,provider);
}
{
 const rel=dir+'auth/AuthContext.jsx',s=read(rel),mark=s.indexOf('export function useAuth()');
 if(mark<0||!s.includes('const AuthContext = createContext(null);'))throw Error('AuthContext source changed');
 const hook=s.slice(mark);
 store(dir+'auth/useAuth.js',`import { useContext } from 'react';\nimport { AuthContext } from './AuthState';\n${hook}`);
 store(dir+'auth/AuthState.js',`import { createContext } from 'react';\nexport const AuthContext = createContext(null);\n`);
 store(rel,s.slice(0,mark).replace('createContext, ', '').replace('useContext, ', '').replace('const AuthContext = createContext(null);',"import { AuthContext } from './AuthState';"));
}
{
 const rel=dir+'components/CaseExtras.jsx',s=read(rel);
 const a=s.indexOf('export function repeatDue('), b=s.indexOf('export function VitalsHistory(');
 const c=s.indexOf('export function allergyText('),d=s.indexOf('export function HandoverSummary(');
 if([a,b,c,d].some(x=>x<0))throw Error('CaseExtras source changed');
 const helpers=s.slice(a,b)+s.slice(c,d);
 store(dir+'lib/caseExtrasText.js',`import { minsSince } from './format';\n\n${helpers}`);
 let component=s.slice(0,a)+s.slice(b,c)+s.slice(d);
 component=component.replace('fmtNum, localTime, agoText, minsSince', 'fmtNum, localTime, agoText');
 component=component.replace('import { SCORE_NAME } from "../lib/terms";',`import { SCORE_NAME } from "../lib/terms";\nimport { repeatDue, allergyText, medsText } from '../lib/caseExtrasText';`);
 store(rel,component);
}
{
 const rel=dir+'pages/AdminVerifiedPurge.jsx',s=read(rel);
 const a=s.indexOf('export function useVerifiedPurge('),b=s.indexOf('function Item(');
 if(a<0||b<0)throw Error('AdminVerifiedPurge source changed');
 const fn=s.slice(a,b);
 store(dir+'lib/useVerifiedPurge.js',`import {useCallback,useState} from 'react';\nimport {adminApi} from '../api/admin';\nconst confirmText='DELETE VERIFIED TEST DATA';\n${fn}`);
 let component=s.slice(0,a)+s.slice(b);
 component=component.replace('import {useCallback,useState}', 'import {useState}').replace("import {adminApi} from '../api/admin';\n",'');
 store(rel,component);
}
{
 const rel=dir+'pages/AdminCleanup.jsx',s=read(rel);
 const a=s.indexOf('export function useCleanup('),b=s.indexOf('export function CleanupPanel(');
 if(a<0||b<0)throw Error('AdminCleanup source changed');
 const hook=s.slice(a,b);
 store(dir+'lib/useCleanup.js',`import {useState} from 'react';\nimport {adminApi} from '../api/admin';\n${hook}`);
 let component=s.slice(0,a)+s.slice(b);
 component=component.replace("import {useState} from 'react';\n",'').replace("import {adminApi} from '../api/admin';\n",'');
 store(rel,component);
}
// Match and rewrite *all* named imports of the moved symbols.
const moved={
 'CaseNav': {'CaseNavProvider':'KEEP','useCaseNav':'../lib/caseNavHooks','useRegisterCaseNav':'../lib/caseNavHooks','STEP_DEFS':'../lib/caseNavHooks','stepDone':'../lib/caseNavHooks','useVisitNav':'../lib/caseNavHooks','useRegisterVisitNav':'../lib/caseNavHooks','VISIT_SECTIONS':'../lib/caseNavHooks'},
 'AuthContext': {'AuthProvider':'KEEP','useAuth':'AUTH_HOOK'},
 'CaseExtras': {'VitalsHistory':'KEEP','HandoverSummary':'KEEP','Timeline':'KEEP','repeatDue':'../lib/caseExtrasText','allergyText':'../lib/caseExtrasText','medsText':'../lib/caseExtrasText'},
 'AdminVerifiedPurge': {'VerifiedPurgePanel':'KEEP','useVerifiedPurge':'../lib/useVerifiedPurge'},
 'AdminCleanup': {'CleanupPanel':'KEEP','useCleanup':'../lib/useCleanup'},
};
function allSrc(folder){let out=[];for(const ent of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,ent.name);if(ent.isDirectory())out.push(...allSrc(full));else if(/\.[cm]?[jt]sx?$/.test(ent.name))out.push(full)}return out}
for(const full of allSrc(path.join(repo,dir))){
 const rel=path.relative(repo,full).replaceAll('\\','/');
 let s=read(rel),old=s;
 // Select only matching relative component imports; do not rewrite imports from external packages.
 s=s.replace(/import\s*\{([^}]+)\}\s*from\s*(['"])([^'"\n]+)\2\s*;?/g,(whole,inside,quote,from)=>{
  const base=path.basename(from).replace(/\.[jt]sx?$/,'');
  if(!moved[base])return whole;
  const names=inside.split(',').map(x=>x.trim()).filter(Boolean);
  const groups=new Map();
  for(const name of names){let to=moved[base][name];if(!to)throw Error(`Unknown ${base} export ${name} in ${rel}`);
   if(to==='KEEP')to=from;
   else if(to==='AUTH_HOOK')to=path.posix.relative(path.posix.dirname(rel),dir+'auth/useAuth.js');
   else to=path.posix.relative(path.posix.dirname(rel),path.posix.normalize(path.posix.join(path.posix.dirname(dir+'components/'+base+'.jsx'),to)));
   if(!to.startsWith('.'))to='./'+to;
   if(!groups.has(to))groups.set(to,[]);groups.get(to).push(name);
  }
  return [...groups].map(([to,n])=>`import { ${n.join(', ')} } from '${to.replace(/\.[jt]sx?$/,'')}';`).join('\n');
 });
 if(s!==old)store(rel,s);
}

// Files written only after every exact pattern above matched.
for(const [rel,s] of pending){const full=path.join(repo,rel);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,s,'utf8')}
console.log(`Updated ${pending.size} existing frontend files. No backend/Neon/GitHub changes.`);
console.log('Next: cd frontend && npm run build && npm run lint');
