import {useCallback,useEffect,useMemo,useState} from 'react';
import {adminApi} from '../api/admin';
import AdminDialog from './AdminDialog';
import {useCleanup,CleanupPanel} from './AdminCleanup';
import {Action,Empty,Notice,PageHeader,Panel,Pill,ROLE_LABEL,useAdminTask,when} from './AdminShared';
const mayDelete=u=>['DOCTOR','ER_STAFF','PARAMEDIC'].includes(u.role);
export default function AdminUsers(){
 const [users,setUsers]=useState([]),[filter,setFilter]=useState('ALL'),[q,setQ]=useState(''),[loading,setLoading]=useState(true),[dialog,setDialog]=useState(null);
 const refresh=useCallback(async()=>setUsers(await adminApi.users()),[]);
 const {busy,error,message,run}=useAdminTask(refresh);
 const cleanup=useCleanup('users',refresh);
 useEffect(()=>{refresh().catch(()=>{}).finally(()=>setLoading(false))},[refresh]);
 const visible=useMemo(()=>users.filter(u=>(filter==='ALL'||u.role===filter)&&[u.username,u.email,u.full_name].join(' ').toLowerCase().includes(q.toLowerCase())),[users,filter,q]);
 function status(u){const active=!u.is_active;setDialog({title:`${active?'Reactivate':'Deactivate'} ${u.username}?`,description:active?'Restore access for this account. Unaccepted invitations must still be accepted.':'This user will lose API access immediately. Their records will be retained.',minReason:8,button:active?'Reactivate':'Deactivate',onConfirm:({reason})=>run('status'+u.user_id,()=>adminApi.status(u.user_id,active,reason),`Account ${active?'reactivated':'deactivated'}.`)})}
 function reset(u){setDialog({title:'Send password reset?',description:`Send a one-time password reset email to ${u.email}. This will not reveal or overwrite the current password.`,button:'Send secure link',onConfirm:()=>run('reset'+u.user_id,()=>adminApi.reset(u.user_id),'Password reset link requested.')})}
 function remove(u){setDialog({title:`Delete ${u.username}?`,description:'This action permanently removes the account only if there are no linked clinical or operational records. The server checks eligibility again before deleting.',danger:true,minReason:10,phrase:'DELETE 1',button:'Permanently delete',onConfirm:({reason})=>run('remove'+u.user_id,()=>adminApi.cleanupExecute('users',[u.user_id],reason,'DELETE 1'),'Account removed and action audited.')})}
 return <div className="flex flex-col gap-5">
  <PageHeader title="User directory" description="Manage staff and patient access. Review and remove explicitly selected test accounts only when they have no clinical or operational dependencies."><Action onClick={()=>run('refresh',async()=>{},'Directory refreshed')}>Refresh</Action></PageHeader>
  <Panel><div className="flex flex-wrap gap-3"><input className="field min-w-[190px] flex-1" aria-label="Search users" placeholder="Search names, users or email…" value={q} onChange={e=>setQ(e.target.value)}/><select className="field" aria-label="Filter by role" value={filter} onChange={e=>setFilter(e.target.value)}>{['ALL','DOCTOR','ER_STAFF','PARAMEDIC','PATIENT','ADMIN'].map(x=><option key={x} value={x}>{x==='ALL'?'All roles':ROLE_LABEL[x]}</option>)}</select></div></Panel>
  <CleanupPanel cleanup={cleanup} kind="users" eligibleVisible={visible.filter(mayDelete).map(u=>u.user_id)}/>
  <Notice error={error} message={message}/>
  {loading?<Empty>Loading directory…</Empty>:visible.length===0?<Empty>No accounts match the search.</Empty>:
   <div className="grid gap-3">{visible.map(u=><Panel key={u.user_id}><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3">{mayDelete(u)&&<label title="Select account for cleanup" className="pt-1"><input type="checkbox" className="h-5 w-5 accent-slate-900" checked={cleanup.chosen.includes(u.user_id)} onChange={e=>cleanup.toggle(u.user_id,e.target.checked)} aria-label={`Select ${u.username} for deletion`}/></label>}<div className="min-w-0"><div className="text-lg font-semibold">{u.full_name||u.username}</div><div className="mt-1 break-all text-sm text-muted">@{u.username} · {u.email||'No email'}</div><div className="mt-3 flex flex-wrap gap-2"><Pill>{ROLE_LABEL[u.role]||u.role}</Pill><Pill tone={u.is_active?'good':'bad'}>{u.is_active?'Active':'Inactive'}</Pill>{u.specialization&&<Pill>{u.specialization}</Pill>}</div></div></div><div className="text-right text-xs leading-6 text-muted">User #{u.user_id}<div>Joined {when(u.created_at)}</div></div></div><div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">{u.role!=='ADMIN'&&<Action disabled={!!busy} onClick={()=>status(u)}>{u.is_active?'Deactivate':'Reactivate'}</Action>}{u.is_active&&u.email&&u.accepted_at&&mayDelete(u)&&<Action disabled={!!busy} onClick={()=>reset(u)}>Send password reset</Action>}{mayDelete(u)&&<Action danger disabled={!!busy} onClick={()=>remove(u)}>Delete account</Action>}</div></Panel>)}</div>}
  <p className="text-xs leading-5 text-muted">Permanent deletion is guarded by backend foreign-key/reference checks. Administrator and patient accounts are excluded from cleanup; deactivate patient accounts instead. Select up to 25 staff accounts per batch.</p>
  <AdminDialog config={dialog} busy={!!busy} onClose={()=>setDialog(null)} onConfirm={async values=>{setDialog(null);await dialog?.onConfirm(values)}}/>
 </div>;
}
