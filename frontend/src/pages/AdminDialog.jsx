import {useEffect,useId,useState} from 'react';

/** Accessible, centered, non-native confirmation. Never put secrets in these dialogs. */
export default function AdminDialog(props){
 if(!props.config)return null;
 return <DialogContent key={[props.config.title,props.config.phrase].join(':')} {...props}/>;
}
function DialogContent({config,onClose,onConfirm,busy=false}){
 const [reason,setReason]=useState('');
 const [confirmation,setConfirmation]=useState('');
 const headingId=useId();
 // State resets by remounting the keyed DialogContent when the action changes.
 useEffect(()=>{
  if(!config)return undefined;
  const onKey=e=>{if(e.key==='Escape'&&!busy)onClose()};
  document.addEventListener('keydown',onKey);
  return ()=>document.removeEventListener('keydown',onKey);
 },[config,busy,onClose]);
 if(!config)return null;
 const min=config.minReason||0;
 const valid=reason.trim().length>=min&&(!config.phrase||confirmation.trim()===config.phrase);
 function submit(e){e.preventDefault();if(valid&&!busy)onConfirm({reason:reason.trim()})}
 return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
  <section role="dialog" aria-modal="true" aria-labelledby={headingId} className="max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-[30px] border border-line bg-surface p-6 shadow-2xl md:p-8">
   <div className="mb-5 flex items-start justify-between gap-4"><div className="flex items-center gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${config.danger?'bg-rose-100 text-rose-700':'bg-lavender text-ink'}`}>{config.danger?'!':'✓'}</span><h2 id={headingId} className="m-0 text-2xl font-semibold tracking-tight">{config.title}</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-full bg-soft px-3 py-1.5 text-lg hover:bg-page">×</button></div>
   <p className="mb-5 whitespace-pre-line text-sm leading-6 text-muted">{config.description}</p>
   <form onSubmit={submit} className="space-y-4">
    {min>0&&<label className="block text-sm font-semibold">Administrative reason <span className="font-normal text-muted">({min}+ characters)</span><textarea autoFocus maxLength={500} rows={3} className="field mt-2 w-full resize-y rounded-2xl!" placeholder="Explain why this action is necessary" value={reason} onChange={e=>setReason(e.target.value)}/></label>}
    {config.phrase&&<label className="block text-sm font-semibold">Type <code className="rounded-lg bg-soft px-2 py-1">{config.phrase}</code> to confirm<input autoFocus={!min} autoComplete="off" spellCheck={false} className="field mt-2 w-full" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={config.phrase}/></label>}
    <div className="flex justify-end gap-2 pt-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-full border border-line px-5 py-3 text-sm font-semibold hover:bg-soft">Cancel</button><button type="submit" disabled={!valid||busy} className={`rounded-full px-6 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${config.danger?'bg-rose-600 text-white':'bg-ink text-white'}`}>{busy?'Working…':config.button||'Confirm'}</button></div>
   </form>
  </section>
 </div>;
}
