import {useCallback,useState} from 'react';
import {adminApi} from '../api/admin';
const confirmText='DELETE VERIFIED TEST DATA';
export function useVerifiedPurge(kind,refresh){
 const [chosen,setChosen]=useState([]),[plan,setPlan]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const toggle=useCallback((id,checked)=>{setChosen(old=>checked?(old.includes(id)?old:old.length>=100?old:[...old,id]):old.filter(x=>x!==id));setPlan(null)},[]);
 const select=useCallback(ids=>{setChosen(old=>[...new Set([...old,...ids])].slice(0,100));setPlan(null)},[]);
 const clear=useCallback(()=>{setChosen([]);setPlan(null)},[]);
 async function preview(){if(!chosen.length)return;setLoading(true);setError('');setMessage('');setPlan(null);try{setPlan(await adminApi.verifiedPurgePreview(kind,chosen))}catch(e){setError(e.message)}finally{setLoading(false)}}
 async function execute(reason){if(!plan?.eligible)return;setLoading(true);setError('');try{
  const result=await adminApi.verifiedPurgeExecute(kind,chosen,reason,plan.digest,confirmText);
  clear();setMessage(`${result.deleted_users} account(s) and ${result.deleted_cases} case(s) deleted. Related ER visits and patients were preserved.`);
  await refresh();window.dispatchEvent(new Event('parvah-admin-refresh'));
 }catch(e){setError(e.message);setPlan(null)}finally{setLoading(false)}}
 return {chosen,toggle,select,clear,preview,execute,plan,loading,error,message};
}
