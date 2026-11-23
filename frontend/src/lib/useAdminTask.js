import { useState } from 'react';
export function useAdminTask(refresh){const [busy,setBusy]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function run(key,task,success){setBusy(key);setError('');setMessage('');try{await task();setMessage(success);if(refresh)await refresh();}catch(e){setError(e.message||'Something went wrong');}finally{setBusy(null)}}
  return {busy,error,message,run,setError,setMessage};}
