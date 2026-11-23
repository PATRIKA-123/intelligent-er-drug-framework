const TODAY=new Date().toISOString().slice(0,10);
// Required demographic fields for a newly registered ER visit.
export default function PatientFields({value,onChange,idPrefix='pf'}){
 const set=k=>e=>onChange({...value,[k]:e.target.value});
 const field=(key,label,props={})=><div className="flex flex-col gap-1.5" key={key}>
  <label htmlFor={`${idPrefix}-${key}`} className="text-[13px] font-semibold">{label} *</label>
  <input id={`${idPrefix}-${key}`} required className="field" value={value[key]||''} onChange={set(key)} {...props}/>
 </div>;
 return <>
  {field('patient_name','Patient name',{maxLength:150})}
  <div className="grid gap-3.5 sm:grid-cols-2">
   {field('dob','Date of birth',{type:'date',max:TODAY})}
   {field('phone','Phone number',{type:'tel',maxLength:30,autoComplete:'tel'})}
  </div>
  {field('email','Email address',{type:'email',maxLength:150,autoComplete:'email'})}
 </>;
}
