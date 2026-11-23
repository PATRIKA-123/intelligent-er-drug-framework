import {useCallback,useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router';
import {adminApi} from '../api/admin';
import {Action,Empty,PageHeader,Panel,Pill,ROLE_LABEL,when} from './AdminShared';
const TABS=[
 {key:'archived_accounts',title:'Archived accounts',subtitle:'Logins removed; references retained'},
 {key:'closed_cases',title:'Closed cases',subtitle:'Completed cases retained in the database'},
 {key:'invitation_history',title:'Invitations',subtitle:'Accepted, expired and revoked'},
 {key:'audit_events',title:'Data & deletion log',subtitle:'Historical admin actions and deletions'},
];
const fmt=x=>when(x)||'—';
function Entry({title,meta,children}){
 return <article className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
  <div className="flex flex-wrap items-start justify-between gap-2"><strong className="break-all text-[15px]">{title}</strong><span className="text-xs text-muted">{meta}</span></div>
  <div className="mt-2 text-sm leading-6 text-muted">{children}</div>
 </article>;
}
export default function AdminHistory(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState('archived_accounts'),[q,setQ]=useState('');
 const reload=useCallback(async()=>{setBusy(true);setError('');try{setData(await adminApi.history())}catch(e){setError(e.message)}finally{setBusy(false)}},[]);
 useEffect(()=>{reload()},[reload]);
 const rows=useMemo(()=>{const found=data?.[tab]||[];return found.filter(row=>Object.values(row).join(' ').toLowerCase().includes(q.toLowerCase().trim()))},[data,tab,q]);
 const count=key=>data?.[key]?.length??'—';
 return <div className="flex flex-col gap-5">
  <PageHeader title="Archive & history" description="Explore archived accounts, closed paramedic cases, invitation outcomes and retained administrative deletion records. Nothing on this page deletes or restores data."><Action disabled={busy} onClick={reload}>{busy?'Refreshing…':'Refresh'}</Action></PageHeader>
  <Panel>
   <nav aria-label="History sections" className="grid grid-cols-2 gap-2 lg:grid-cols-4">{TABS.map(t=><button type="button" key={t.key} onClick={()=>{setTab(t.key);setQ('')}} aria-pressed={tab===t.key} className={`rounded-2xl border px-3 py-3 text-left transition ${tab===t.key?'border-ink bg-ink text-white':'border-line bg-soft hover:bg-mint'}`}><div className="text-sm font-semibold">{t.title}</div><div className="mt-1 text-xs opacity-75">{count(t.key)} records</div></button>)}</nav>
   <div className="mt-4 flex flex-wrap items-center gap-3"><input className="field min-w-0 flex-1" aria-label="Search history" value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${TABS.find(t=>t.key===tab)?.title.toLowerCase()}`}/><span className="text-xs text-muted">Showing latest {data?.caps?.[tab]||250} maximum</span></div>
  </Panel>
  {error&&<p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
  {tab==='closed_cases'&&<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Closed cases are retained clinical records, not archived or deleted cases. They must not be purged merely because they are closed.</p>}
  {tab==='audit_events'&&<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">The audit log is historical evidence, not a backup. Permanently deleted records cannot be restored from here.</p>}
  {busy&&!data?<Empty>Loading history…</Empty>:rows.length===0?<Empty>No history records to show.</Empty>:
   <div className="grid gap-3">{tab==='archived_accounts'&&rows.map(r=><Entry key={r.user_id} title={`${r.full_name||r.username} · @${r.username}`} meta={`Archived ${fmt(r.archived_at)}`}><div className="flex flex-wrap items-center gap-2"><Pill>{ROLE_LABEL[r.role]||r.role}</Pill><Pill tone="bad">Login disabled</Pill></div><div className="mt-2">User #{r.user_id} · {r.email||'No email'} · Created {fmt(r.created_at)}</div></Entry>)}
   {tab==='closed_cases'&&rows.map(r=><Entry key={r.case_id} title={`${r.temporary_case_code} · Case #${r.case_id}`} meta={fmt(r.created_at)}><div className="flex flex-wrap gap-2"><Pill>Closed</Pill><Pill>Created by {r.creator||'Unknown'}</Pill>{r.stay_id&&<Pill>ER visit #{r.stay_id}</Pill>}</div><div className="mt-2">{r.assessments} assessments · {r.vitals} vitals · {r.transports} transport records</div><div className="mt-2"><Link to="/admin/operations" className="font-semibold underline">Operations</Link></div></Entry>)}
   {tab==='invitation_history'&&rows.map(r=><Entry key={r.invitation_id} title={`Invitation #${r.invitation_id} · ${r.username}`} meta={fmt(r.created_at)}><div className="flex flex-wrap gap-2"><Pill>{ROLE_LABEL[r.role]||r.role}</Pill><Pill tone={r.accepted_at?'good':'bad'}>{r.accepted_at?'Accepted':r.revoked_at?'Revoked':'Expired'}</Pill></div>{r.accepted_at&&<div>Accepted {fmt(r.accepted_at)}</div>}{r.revoked_at&&<div>Revoked {fmt(r.revoked_at)}</div>}</Entry>)}
   {tab==='audit_events'&&rows.map(r=><Entry key={r.audit_id} title={r.action.replaceAll('_',' ')} meta={fmt(r.created_at)}><div>Audit #{r.audit_id} · {r.target_type||'—'} #{r.target_id||'—'} · by admin #{r.actor_user_id||'unknown'}</div><details className="mt-2"><summary className="cursor-pointer font-semibold text-ink">View logged reason and affected records</summary><p className="mt-2 break-words whitespace-pre-wrap text-xs">{r.reason||'No additional details were recorded.'}</p></details></Entry>)}
   </div>}
 </div>;
}
