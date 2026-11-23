import { useState } from 'react';
import { Link } from 'react-router';
import { api, USE_MOCK } from '../api';
import Button from '../components/Button';
import Icon from '../components/Icon';

export default function AddVisit(){
 const [f,setF]=useState({stay_id:'',access_code:'',phone_last4:''});
 const [err,setErr]=useState(''),[linked,setLinked]=useState(null),[busy,setBusy]=useState(false);
 const set=k=>e=>setF(x=>({...x,[k]:e.target.value}));
 async function submit(e){
  e.preventDefault();setErr('');setLinked(null);
  if(!/^\d+$/.test(f.stay_id.trim()))return setErr('Enter the ER visit ID.');
  if(!/^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/i.test(f.access_code.trim()))return setErr('Enter the 8-character access code on your slip.');
  if(!/^\d{4}$/.test(f.phone_last4))return setErr('Enter the last 4 digits of the phone number recorded at the ER.');
  setBusy(true);
  try{const r=await api.claimVisit({stay_id:f.stay_id.trim(),access_code:f.access_code.trim(),phone_last4:f.phone_last4});
   if(r.status==='PENDING_VERIFICATION')throw new Error('The backend has not been updated to automatic claiming. Ask the administrator to deploy the new backend.');
   setLinked(r.stay_id||f.stay_id.trim());setF({stay_id:'',access_code:'',phone_last4:''});
  }catch(x){setErr(x.message);}finally{setBusy(false);}
 }
 return <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
  <div><h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight">Add a visit</h1><p className="mt-2.5 text-[15px] text-muted">Enter the single-use code the ER desk gave you. A valid code and matching phone digits immediately link an unclaimed visit.</p></div>
  <form onSubmit={submit} className="panel flex flex-col gap-4 p-7!">
   <div className="flex flex-col gap-1.5"><label htmlFor="av-id" className="text-[13px] font-semibold">Visit ID</label><input id="av-id" required inputMode="numeric" className="field" value={f.stay_id} onChange={set('stay_id')}/></div>
   <div className="flex flex-col gap-1.5"><label htmlFor="av-code" className="text-[13px] font-semibold">Access code</label><input id="av-code" required className="field uppercase tracking-widest" value={f.access_code} onChange={set('access_code')} autoComplete="off"/></div>
   <div className="flex flex-col gap-1.5"><label htmlFor="av-phone" className="text-[13px] font-semibold">Last 4 digits of your phone</label><input id="av-phone" required inputMode="numeric" maxLength={4} className="field w-40" value={f.phone_last4} onChange={set('phone_last4')} autoComplete="off"/><span className="text-xs text-muted">Must match the number recorded at the ER desk.</span></div>
   {linked&&<p role="status" className="m-0 rounded-2xl bg-risk-low-bg p-4 text-sm font-semibold">Visit {linked} is now linked to your profile. <Link to="/patient" className="underline">View my visits</Link></p>}
   {err&&<p role="alert" className="m-0 flex items-center gap-2 text-sm text-risk-high-bg"><Icon name="alert" size={16} color="#C62828"/>{err}</p>}
   <Button type="submit" disabled={busy} className="h-14 text-base">{busy?'Checking code…':'Add visit now'}</Button>
  </form>
  {USE_MOCK&&<p className="rounded-2xl bg-lavender p-4 text-sm">Sample mode: use the sample credentials from the existing demo.</p>}
 </div>;
}
