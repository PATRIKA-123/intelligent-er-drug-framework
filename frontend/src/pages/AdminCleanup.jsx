import {useState} from 'react';
import AdminDialog from './AdminDialog';
import {adminApi} from '../api/admin';
import {Action,Notice,Panel} from './AdminShared';

// Select only explicit IDs. No pattern matching or automatic deletion of all rows.
export function useCleanup(kind,refresh){
 const [chosen,setChosen]=useState([]);
 const [preview,setPreview]=useState(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 function toggle(id,yes){setChosen(a=>yes ? (a.includes(id)?a:a.length>=25?a:[...a,id]):a.filter(x=>x!==id));setPreview(null);}
 function select(ids){setChosen(a=>[...new Set([...a,...ids])].slice(0,25));setPreview(null)}
 function clear(){setChosen([]);setPreview(null)}
 async function inspect(ids=chosen){
  if(ids.length<1)return;
  setError('');setMessage('');setLoading(true);
  try{setPreview(await adminApi.cleanupPreview(kind,ids));}catch(e){setError(e.message)}finally{setLoading(false)}
 }
 async function execute({reason}){
  if(!preview||preview.blocked)return;
  setLoading(true);setError('');
  try{
   const result=await adminApi.cleanupExecute(kind,preview.rows.map(r=>r.id),reason,`DELETE ${preview.rows.length}`);
   setMessage(result.message);clear();await refresh();
  }catch(e){setError(e.data?.rows?.filter(r=>!r.eligible).map(r=>`${r.label||r.id}: ${r.reason}`).join('; ')||e.message);setPreview(null)}
  finally{setLoading(false)}
 }
 return {chosen,toggle,select,clear,inspect,preview,setPreview,loading,error,message,execute};
}
export function CleanupPanel({cleanup,kind,eligibleVisible=[]}){
 const {chosen,select,clear,inspect,preview,setPreview,loading,error,message,execute}=cleanup;
 return <>
  <Panel className="flex flex-wrap items-center justify-between gap-3 border-dashed!">
   <div><div className="text-sm font-semibold">Test-data cleanup <span className="ml-2 rounded-full bg-soft px-3 py-1 text-xs">{chosen.length}/25 selected</span></div><p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-muted">Select specific {kind==='users'?'staff accounts':'paramedic cases'} below. Preview verifies every record on the server. A batch is all-or-nothing and never erases referenced clinical records.</p></div>
   <div className="flex flex-wrap gap-2"><Action disabled={loading||!eligibleVisible.length} onClick={()=>select(eligibleVisible)}>Select visible (max 25)</Action><Action disabled={loading||!chosen.length} onClick={clear}>Clear</Action><Action danger disabled={loading||!chosen.length} onClick={()=>inspect()}>{loading?'Checking…':`Review deletion (${chosen.length})`}</Action></div>
  </Panel>
  <Notice error={error} message={message}/>
  {preview?.blocked>0&&<Panel><h3 className="m-0 text-lg font-semibold">{preview.blocked} selected record(s) cannot be removed</h3><p className="text-sm text-muted">No changes were made. Remove blocked selections to continue.</p><div className="max-h-60 overflow-auto">{preview.rows.map(r=><div key={r.id} className="border-b border-line py-2 text-xs">{r.eligible?'✓':'✕'} {r.label||'#'+r.id}: {r.reason||'Eligible'}</div>)}</div><div className="mt-4 flex gap-2"><Action onClick={()=>{setPreview(null);clear()}}>Clear selection</Action><Action onClick={()=>{setPreview(null);const ids=preview.rows.filter(r=>r.eligible).map(r=>r.id);clear();select(ids)}}>Keep eligible only</Action></div></Panel>}
  {preview?.blocked===0&&<AdminDialog config={{title:`Delete ${preview.rows.length} ${kind==='users'?'accounts':'empty cases'}?`,
   description:preview.rows.map(x=>`✓ ${x.label||'#'+x.id} — eligible`).join('\n').slice(0,1500)+'\n\nThis is permanent, cannot be undone, and will be recorded in the admin audit log.',
   danger:true,button:'Permanently delete',minReason:10,phrase:`DELETE ${preview.rows.length}`}} onClose={()=>setPreview(null)} onConfirm={execute} busy={loading} />}
 </>;
}
