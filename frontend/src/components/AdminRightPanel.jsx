import {useCallback,useEffect,useMemo,useState} from 'react';
import {Link,useLocation} from 'react-router';
import {adminApi} from '../api/admin';
import {useAuth} from '../auth/AuthContext';
const percent=(num,total)=>total?Math.min(100,Math.round(num/total*100)):0;
const sections=[{key:'accounts',label:'Accounts'},{key:'invitations',label:'Invites'},{key:'operations',label:'Operations'}];
function Metric({label,value,sub,href}){
 const inner=<div className="flex items-center justify-between gap-3 border-b border-line py-2.5"><div className="min-w-0"><div className="text-sm text-muted">{label}</div>{sub&&<div className="text-[11px] text-muted">{sub}</div>}</div><strong className="text-base tabular-nums">{value??'—'}</strong></div>;
 return href?<Link className="block rounded-lg px-1 transition hover:bg-soft" to={href}>{inner}</Link>:inner;
}
export default function AdminRightPanel(){
 const {user}=useAuth();const location=useLocation();
 const [tab,setTab]=useState('accounts'),[state,setState]=useState({data:null,loading:true,error:'',updated:null});
 const reload=useCallback(async()=>{setState(s=>({...s,loading:true,error:''}));try{const data=await adminApi.summary();setState({data,loading:false,error:'',updated:new Date()})}catch(e){setState(s=>({...s,loading:false,error:e.message}))}},[]);
 useEffect(()=>{reload()},[location.pathname,reload]);
 useEffect(()=>{const listener=()=>reload();window.addEventListener('parvah-admin-refresh',listener);return()=>window.removeEventListener('parvah-admin-refresh',listener)},[reload]);
 const d=state.data;
 const roleStats=useMemo(()=>[{label:'Doctors',key:'DOCTOR',num:d?.doctors},{label:'ER staff',key:'ER_STAFF',num:d?.er_staff},{label:'Paramedics',key:'PARAMEDIC',num:d?.paramedics},{label:'Patients',key:'PATIENT',num:d?.patients}], [d]);
 const total=d?.users_total||0;
 return <aside aria-label="Interactive admin analytics" className="sticky top-6 hidden w-[292px] flex-none flex-col gap-4 self-start xl:flex">
  <section className="rounded-[26px] bg-mint p-5"><div className="text-xs font-semibold uppercase tracking-[.16em] text-muted">Administrator</div><div className="mt-2 truncate text-lg font-semibold">{user.username}</div><div className="mt-1 text-xs text-muted">Operational command centre</div></section>
  <section className="rounded-[26px] border border-line bg-surface p-4 shadow-sm">
   <div className="mb-3 flex items-center justify-between gap-2"><h2 className="m-0 text-base font-semibold">Live analytics</h2><button type="button" disabled={state.loading} onClick={reload} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:bg-soft disabled:opacity-50" aria-label="Refresh admin analytics">{state.loading?'Updating…':'↻ Refresh'}</button></div>
   <div role="tablist" aria-label="Analytics view" className="grid grid-cols-3 gap-1 rounded-2xl bg-soft p-1">{sections.map(x=><button type="button" role="tab" aria-selected={tab===x.key} key={x.key} onClick={()=>setTab(x.key)} className={`rounded-xl px-1 py-2 text-[11px] font-semibold transition ${tab===x.key?'bg-ink text-white shadow-sm':'hover:bg-surface'}`}>{x.label}</button>)}</div>
   {state.error&&<p role="alert" className="mt-3 text-xs text-rose-700">{state.error}</p>}
   {d&&tab==='accounts'&&<div className="pt-2"><Metric label="All accounts" value={d.users_total} href="/admin/users"/><Metric label="Active accounts" value={d.users_active} href="/admin/users"/><div className="mt-4 space-y-3">{roleStats.map(r=><Link to={`/admin/users?role=${r.key}`} title={`Filter ${r.label}`} key={r.key} className="block rounded-xl p-1 transition hover:bg-soft"><div className="mb-1 flex justify-between gap-2 text-xs"><span>{r.label}</span><strong>{r.num??'—'} <span className="font-normal text-muted">({percent(r.num,total)}%)</span></strong></div><div className="h-2 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-ink transition-all duration-500" style={{width:`${percent(r.num,total)}%`}}/></div></Link>)}</div></div>}
   {d&&tab==='invitations'&&<div className="pt-2"><Metric label="Awaiting acceptance" value={d.invites_pending} href="/admin/invitations"/><Metric label="Accepted" value={d.invites_accepted} href="/admin/invitations"/><Metric label="Expired / revoked" value={d.invites_other} href="/admin/invitations"/><Link className="mt-4 flex justify-center rounded-full bg-ink px-4 py-2.5 text-xs font-semibold text-white" to="/admin">Invite a colleague</Link></div>}
   {d&&tab==='operations'&&<div className="pt-2"><Metric label="Open paramedic cases" value={d.cases_open} href="/admin/operations?tab=cases"/><Metric label="Patients on ER board" value={d.stays_current} href="/admin/operations?tab=stays"/><Metric label="Doctor assigned" value={d.stays_assigned} href="/admin/operations?tab=stays"/><div className="mt-4 rounded-2xl bg-soft p-3"><div className="flex justify-between text-xs"><span>Doctor assignment coverage</span><strong>{percent(d.stays_assigned,d.stays_current)}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-page"><div className="h-full rounded-full bg-ink transition-all duration-500" style={{width:`${percent(d.stays_assigned,d.stays_current)}%`}}/></div></div></div>}
   {state.updated&&<p className="mb-0 mt-4 text-[11px] text-muted">Updated {state.updated.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})} · Select a metric to open its page</p>}
  </section>
  <section className="rounded-[26px] border border-line bg-surface p-4 shadow-sm"><h2 className="m-0 text-base font-semibold">Quick actions</h2><div className="mt-3 grid grid-cols-2 gap-2">{[{label:'New invite',to:'/admin'},{label:'Invitations',to:'/admin/invitations'},{label:'Manage users',to:'/admin/users'},{label:'ER operations',to:'/admin/operations'}].map(x=><Link to={x.to} key={x.to} className="rounded-xl border border-line px-3 py-3 text-center text-xs font-semibold transition hover:border-ink hover:bg-soft">{x.label}</Link>)}</div></section>
  <p className="px-2 text-xs leading-5 text-muted">Statistics reflect the current Neon database. Use Refresh after cleaning test records.</p>
 </aside>;
}
