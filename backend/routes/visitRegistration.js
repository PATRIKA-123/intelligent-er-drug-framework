"use strict";
const express=require('express');
const router=express.Router();
const auth=require('../middleware/authMiddleware');
const {registerVisit,processingStatus}=require('../services/round2Registration');
const {getClinicalContext}=require('../services/clinicalContextService');
const {generateAndPersistAlerts}=require('../services/alertService');
router.post('/',auth,auth.requireRole('ADMIN','ER_STAFF'),async(req,res)=>{
  let result;
  try {
    result=await registerVisit(req.body,req.user.user_id,req.get('Idempotency-Key'));
    if(result.replayed) return res.status(200).json({message:'Visit previously registered',...result});
    const { _keyHash, ...publicResult } = result;
    // New stays have no measurements. Never fabricate NEWS2 or a reassuring safety result.
    let processing={status:'PENDING_INPUTS'};
    try {
      const context=await getClinicalContext(result.stay_id);
      const usable=context&&(context.latest_news2||context.latest_trend||(context.medications||[]).length);
      if(usable){
        await processingStatus(_keyHash,'RUNNING');
        const outcome=await generateAndPersistAlerts(result.stay_id);
        processing={status:outcome?'COMPLETED':'FAILED'};
        await processingStatus(_keyHash,processing.status);
      }
    }catch(err){processing={status:'FAILED'};console.error('Visit clinical processing failed:',err.code||'PROCESSING_ERROR');
      try{await processingStatus(_keyHash,'FAILED');}catch(_){} }
    return res.status(201).json({message:'ER visit created',...publicResult,processing});
  }catch(err){console.error('Visit registration error:',err.code||'REGISTRATION_ERROR');
    return res.status(err.statusCode||500).json({error:err.statusCode?err.message:'Failed to register ER visit'});}
});
module.exports=router;
