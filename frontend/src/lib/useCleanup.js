import {useState} from 'react';
import {adminApi} from '../api/admin';
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
