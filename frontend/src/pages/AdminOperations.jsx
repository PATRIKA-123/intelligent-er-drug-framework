import {useCallback,useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router';
import {adminApi} from '../api/admin';
import AdminDialog from './AdminDialog';
import { useVerifiedPurge } from '../lib/useVerifiedPurge';
import { VerifiedPurgePanel } from './AdminVerifiedPurge';
import {Action,Empty,Notice,PageHeader,Panel,Pill} from './AdminShared';
import {when} from '../lib/adminFormatting';
import {useAdminTask} from '../lib/useAdminTask';
export default function AdminOperations(){
 const [params,setParams]=useSearchParams();
 const [data,setData]=useState({cases:[],stays:[]}),[caseStatus,setCaseStatus]=useState('ALL'),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[dialog,setDialog]=useState(null);
 const refresh=useCallback(async()=>setData(await adminApi.operations()),[]);
 const {busy,error,message,run}=useAdminTask(refresh);
 const cleanup=useVerifiedPurge('cases',refresh);
 useEffect(()=>{
  let live=true;
  adminApi.operations().then(result=>{if(live)setData(result)}).catch(()=>{}).finally(()=>{if(live)setLoading(false)});
  return ()=>{live=false};
 },[]);
 const tab=params.get('tab')==='stays'?'stays':'cases';
 const cases=(data.cases||[]).filter(c=>(caseStatus==='ALL'||c.case_status===caseStatus)&&[c.temporary_case_code,c.case_id,c.paramedic_name,c.paramedic_username,c.chief_complaint].join(' ').toLowerCase().includes(search.toLowerCase()));
 const stays=(data.stays||[]).filter(s=>[s.stay_id,s.patient_name,s.doctor_name,s.chiefcomplaint].join(' ').toLowerCase().includes(search.toLowerCase()));
 function remove(c){cleanup.clear();cleanup.select([c.case_id]);window.scrollTo({top:0,behavior:'smooth'});}
 return <div className="flex flex-col gap-5"><PageHeader title="Operations overview" description="Monitor paramedic cases, ER patients and the assigned treatment team. Aggregate counts are in the right-hand panel."><Action disabled={!!busy} onClick={()=>run('refresh',async()=>{},'Operational board refreshed')}>Refresh</Action></PageHeader>
 <Panel><div className="flex flex-wrap items-center gap-2"><button onClick={()=>{setParams({tab:'cases'})}} className={`rounded-full px-5 py-3 text-sm font-semibold ${tab==='cases'?'bg-ink text-white':'bg-soft'}`}>Paramedic cases</button><button onClick={()=>{setParams({tab:'stays'})}} className={`rounded-full px-5 py-3 text-sm font-semibold ${tab==='stays'?'bg-ink text-white':'bg-soft'}`}>ER patients</button>{tab==='cases'&&<select className="field" aria-label="Filter case status" value={caseStatus} onChange={e=>setCaseStatus(e.target.value)}>{['ALL','PRE_ER','ARRIVED_ER','ACTIVE_ER','CLOSED'].map(s=><option key={s} value={s}>{s==='ALL'?'All case statuses':s}</option>)}</select>}<input aria-label="Search operational entries" className="field ml-auto min-w-[190px] flex-1 md:max-w-xs" placeholder="Search cases, patients, doctors…" value={search} onChange={e=>setSearch(e.target.value)}/></div></Panel>
 {tab==='cases'&&<VerifiedPurgePanel cleanup={cleanup} kind="cases" visibleIds={cases.map(c=>c.case_id)}/>}
 <Notice error={error} message={message}/>{loading?<Empty>Loading operations…</Empty>:tab==='cases'?cases.length===0?<Empty>No matching open cases.</Empty>:
 <div className="grid gap-3">{cases.map(c=><Panel key={c.case_id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3">{<label className="pt-1"><input type="checkbox" className="h-5 w-5 accent-slate-900" checked={cleanup.chosen.includes(c.case_id)} onChange={e=>cleanup.toggle(c.case_id,e.target.checked)} aria-label={`Select case ${c.case_id} for deletion`}/></label>}<div><div className="text-lg font-semibold">{c.temporary_case_code}</div><div className="mt-1 text-sm text-muted">{c.chief_complaint||'No assessment recorded'}</div><div className="mt-3 flex flex-wrap gap-2"><Pill>{c.case_status}</Pill><Pill>Case #{c.case_id}</Pill></div></div></div><div className="text-xs text-muted">Created {when(c.created_at)}</div></div><div className="mt-4 flex flex-wrap justify-between gap-3 border-t border-line pt-4 text-sm"><div><strong>Paramedic:</strong> {c.paramedic_name||c.paramedic_username||'Unassigned'}<div className="mt-1 text-muted">Linked ER visit: {c.stay_id||'Not yet'}</div></div><div className="flex flex-wrap gap-2">{c.stay_id&&<Link to={`/stays/${c.stay_id}`} className="rounded-full border border-line px-4 py-2 text-xs font-semibold">Open ER visit</Link>}{<Action danger disabled={!!busy} onClick={()=>remove(c)}>Review test-data deletion</Action>}</div></div></Panel>)}</div>:
 stays.length===0?<Empty>No matching ER patients.</Empty>:<div className="grid gap-3">{stays.map(s=><Panel key={s.stay_id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-lg font-semibold">{s.patient_name||`Patient ${s.subject_id||'not identified'}`}</div><div className="mt-1 text-sm text-muted">{s.chiefcomplaint||'Complaint not recorded'}</div><div className="mt-3 flex flex-wrap gap-2"><Pill>Visit #{s.stay_id}</Pill><Pill>{s.visit_status||'In ER'}</Pill>{s.acuity&&<Pill>Acuity {s.acuity}</Pill>}</div></div><div className="text-xs text-muted">Arrived {when(s.intime)}</div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><div className="text-sm"><strong>Treating doctor:</strong> {s.doctor_name||'Not assigned'}{s.specialization&&<div className="mt-1 text-xs text-muted">{s.specialization}</div>}</div><Link className="rounded-full bg-ink px-5 py-3 text-xs font-semibold text-white" to={`/stays/${s.stay_id}`}>Open patient record</Link></div></Panel>)}</div>}
 <p className="text-xs text-muted">The case list includes closed cases and displays up to 1,000 recent entries per category. Totals in the right-hand panel are database-wide. Explicitly reviewed cases can include pre-hospital records and linked visits; ER visit and patient records are retained. New or unknown dependencies block deletion.</p>
 <AdminDialog key={dialog?.title || "dialog"} config={dialog} busy={!!busy} onClose={()=>setDialog(null)} onConfirm={async values=>{setDialog(null);await dialog?.onConfirm(values)}}/>
 </div>;
}
