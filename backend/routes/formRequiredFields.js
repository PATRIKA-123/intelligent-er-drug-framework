'use strict';
// Uniform API validation for required entries. Keeps source clinical routes intact.
// Clinical fields must be measured or explicitly documented; the application
// must never fabricate values just to satisfy a form.
const express=require('express');
const router=express.Router();
const has=v=>typeof v==='string'&&v.trim().length>0;
const mail=v=>has(v)&&v.length<=150&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const phone=v=>has(v)&&String(v).replace(/\D/g,'').length>=7;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&v<=new Date().toISOString().slice(0,10);
function erVisit(req,res,next){
 const b=req.body||{};
 if(b.patient_id!=null)return next(); // existing patient already has demographics
 if(!b.patient||!has(b.patient.full_name)||!date(b.patient.date_of_birth)||!phone(b.patient.phone)||!mail(b.patient.email)||!has(b.chiefcomplaint))
   return res.status(400).json({error:'Patient name, valid date of birth, phone, email and visit reason are required.'});
 return next();
}
router.post('/stays',erVisit);
router.post('/patient/register',(req,res,next)=>{
 const b=req.body||{};
 if(!has(b.full_name)||!date(b.dob)||!phone(b.phone)||!mail(b.email))return res.status(400).json({error:'Patient name, date of birth, phone and email are required.'});
 return next();
});
// Vitals may legitimately be temporarily unmeasurable during emergency care.
// Existing clinical validation accepts partial observations without fabrication.
module.exports=router;
