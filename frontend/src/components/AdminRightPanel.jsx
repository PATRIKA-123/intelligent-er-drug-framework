import {useEffect,useState} from 'react';
import {useLocation} from 'react-router';
import {adminApi} from '../api/admin';
import {useAuth} from '../auth/AuthContext';
const line=(name,n)=> <div key={name} className="flex justify-between gap-2 border-b border-line py-2.5 text-sm"><span className="text-muted">{name}</span><strong className="tabular-nums">{n??'—'}</strong></div>;
export default function AdminRightPanel(){
 const {user}=useAuth();const location=useLocation();
 const [state,setState]=useState({data:null,loading:true,error:''});
 useEffect(()=>{let live=true;adminApi.summary().then(data=>{if(live)setState({data,loading:false,error:''})}).catch(e=>{if(live)setState(s=>({...s,loading:false,error:e.message}))});return()=>{live=false}},[location.pathname]);
 const {data,loading,error}=state;
 return <aside aria-label="Admin analytics" className="sticky top-6 hidden w-[290px] flex-none flex-col gap-4 self-start xl:flex">
  <section className="rounded-[26px] bg-mint p-5"><div className="text-xs font-semibold uppercase tracking-[.16em] text-muted">Administrator</div><div className="mt-2 truncate text-lg font-semibold">{user.username}</div><div className="mt-1 text-xs text-muted">Access & operations overview</div></section>
  <section className="rounded-[26px] border border-line bg-surface p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><h2 className="m-0 text-lg font-semibold">Accounts</h2><span className="rounded-full bg-soft px-2.5 py-1 text-xs">Live</span></div>{loading?<p className="text-sm text-muted">Loading…</p>:error?<p className="text-xs text-rose-700">{error}</p>:<>{line('Total users',data?.users_total)}{line('Active',data?.users_active)}{line('Doctors',data?.doctors)}{line('ER staff',data?.er_staff)}{line('Paramedics',data?.paramedics)}{line('Patients',data?.patients)}</>}</section>
  <section className="rounded-[26px] border border-line bg-surface p-5 shadow-sm"><h2 className="m-0 mb-3 text-lg font-semibold">Invitations</h2>{line('Awaiting acceptance',data?.invites_pending)}{line('Accepted',data?.invites_accepted)}{line('Expired or revoked',data?.invites_other)}</section>
  <section className="rounded-[26px] border border-line bg-surface p-5 shadow-sm"><h2 className="m-0 mb-3 text-lg font-semibold">Operations</h2>{line('Open paramedic cases',data?.cases_open)}{line('Patients on ER board',data?.stays_current)}{line('With doctor assigned',data?.stays_assigned)}</section>
  <p className="px-3 text-xs leading-5 text-muted">These totals come from the Neon database and refresh when you navigate to another admin page.</p>
 </aside>;
}
