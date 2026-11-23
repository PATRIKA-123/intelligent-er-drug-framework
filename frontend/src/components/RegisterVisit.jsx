import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {api} from '../api';
import Button from './Button';
import Icon from './Icon';
import PatientFields from './PatientFields';

// ER visit registration with required patient demographics.
export function RegisterVisit({c,onDone}){
 const [form,setForm]=useState({patient_name:'',dob:'',phone:'',email:''});
 const [complaint,setComplaint]=useState(c.latest_assessment?.chief_complaint||'');
 const [docs,setDocs]=useState(null),[doctor,setDoctor]=useState('');
 const [busy,setBusy]=useState(false),[err,setErr]=useState('');
 const requestKey=useRef(null);
 useEffect(()=>{let live=true;api.listDoctors().then(d=>live&&setDocs(Array.isArray(d)?d:[])).catch(()=>{});return()=>{live=false}},[]);
 async function submit(e){
  e.preventDefault();setErr('');
  if(!form.patient_name.trim())return setErr('Enter patient name.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(form.dob))return setErr('Enter date of birth.');
  if(form.phone.replace(/\D/g,'').length<7)return setErr('Enter a valid phone number.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))return setErr('Enter a valid email address.');
  if(!complaint.trim())return setErr('Enter the reason for the visit.');
  setBusy(true);
  try{
   const body={...form,chief_complaint:complaint.trim()};
   if(doctor)body.doctor_user_id=doctor;
   requestKey.current ||= crypto.randomUUID();
   const result=await api.registerVisit(c.case_id,body,requestKey.current);
   requestKey.current=null;await onDone(result);
  }catch(x){setErr(x.message);}finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="panel flex flex-col gap-4 p-7!">
  <h2 className="m-0 text-[22px] font-semibold tracking-tight">Register the ER visit</h2>
  <PatientFields value={form} onChange={setForm} idPrefix="reg"/>
  <div className="flex flex-col gap-1.5"><label htmlFor="reg-complaint" className="text-[13px] font-semibold">Reason for the visit *</label><input id="reg-complaint" required className="field" value={complaint} onChange={e=>setComplaint(e.target.value)}/></div>
  {docs&&<div className="flex flex-col gap-1.5"><label htmlFor="reg-doctor" className="text-[13px] font-semibold">Doctor assignment</label><select id="reg-doctor" className="field" value={doctor} onChange={e=>setDoctor(e.target.value)}><option value="">To be assigned by ER staff</option>{docs.map(d=><option key={d.user_id} value={d.user_id}>{d.full_name}{d.specialization?`, ${d.specialization}`:''}</option>)}</select><p className="m-0 text-xs text-muted">Only assign a clinician who has accepted responsibility for this patient.</p></div>}
  {err&&<p role="alert" className="m-0 flex items-center gap-2 text-sm text-risk-high-bg"><Icon name="alert" size={16} color="#C62828"/>{err}</p>}
  <Button type="submit" disabled={busy} className="h-14 text-base">{busy?'Registering…':'Register visit'}</Button>
 </form>;
}
export function Slip({slip}){
 return <section className="panel flex flex-col gap-4 p-7!" aria-label="Patient slip">
  <h2 className="m-0 text-[22px] font-semibold tracking-tight">Visit registered</h2>
  <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-mint px-5 py-4"><div className="text-xs font-semibold">Visit ID</div><div className="text-3xl font-semibold tracking-tight">{slip.stay_id}</div></div><div className="rounded-2xl bg-lavender px-5 py-4"><div className="text-xs font-semibold">Single-use access code</div><div className="text-2xl font-semibold tracking-widest">{slip.access_code}</div></div></div>
  <p className="m-0 text-sm">Give this slip directly to the patient. Their valid one-time code and matching recorded phone digits will immediately link an unclaimed visit to their account. Keep this code private. It expires after 14 days.</p>
  {slip.linked_profile&&<p role="status" className="rounded-2xl bg-risk-low-bg p-4 text-sm">Linked to {slip.linked_profile}.</p>}
  <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={()=>window.print()}>Print slip</Button><Button to={`/stays/${slip.stay_id}`}>Open visit</Button></div>
 </section>;
}
export function SlipLink({stayId}){return <Link to={`/stays/${stayId}`} className="underline">visit {stayId}</Link>}
