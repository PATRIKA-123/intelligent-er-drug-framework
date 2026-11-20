'use strict';
const express=require('express');const pool=require('../db');const auth=require('../middleware/authMiddleware');
const {requireStayAccess}=require('../services/accessPolicy');const {calculateNEWS2}=require('../services/news2Calculator');
const router=express.Router();
const fields=['heart_rate','respiratory_rate','systolic_bp','diastolic_bp','spo2','temperature_celsius','consciousness','oxygen_support','spo2_scale'];
const numeric=['heart_rate','respiratory_rate','systolic_bp','diastolic_bp','spo2','temperature_celsius','spo2_scale'];
function parseBody(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Observation object required');
 if(!fields.some(x=>raw[x]!==undefined&&raw[x]!==null))throw Error('At least one measurement required');
 for(const k of numeric)if(raw[k]!==undefined&&(typeof raw[k]!=='number'||!Number.isFinite(raw[k])))throw Error(`${k} must be a number`);
 for(const [k,low,high] of [['heart_rate',0,300],['respiratory_rate',0,100],['systolic_bp',1,350],['diastolic_bp',1,250],['spo2',0,100],['temperature_celsius',25,45]])
   if(raw[k]!==undefined&&(raw[k]<low||raw[k]>high))throw Error(`${k} outside supported range`);
 if(raw.spo2_scale!==undefined&&![1,2].includes(raw.spo2_scale))throw Error('Invalid spo2_scale');
 if(raw.oxygen_support!==undefined&&typeof raw.oxygen_support!=='boolean')throw Error('Invalid oxygen_support');
 if(raw.consciousness!==undefined&&!['ALERT','NEW_CONFUSION','V','P','U'].includes(raw.consciousness))throw Error('Invalid consciousness');
 const when=raw.observation_time===undefined?new Date():new Date(raw.observation_time);
 if(Number.isNaN(when.getTime())||when.getTime()>Date.now()+60000)throw Error('Invalid future observation_time');
 const complete=['heart_rate','respiratory_rate','systolic_bp','spo2','temperature_celsius','consciousness','oxygen_support','spo2_scale'].every(k=>raw[k]!==null&&raw[k]!==undefined);
 let news2=null;
 if(complete)news2=calculateNEWS2({heartRate:raw.heart_rate,respiratoryRate:raw.respiratory_rate,systolicBP:raw.systolic_bp,spo2:raw.spo2,temperatureCelsius:raw.temperature_celsius,consciousness:raw.consciousness,oxygenSupport:raw.oxygen_support,spo2Scale:raw.spo2_scale,scale2ClinicianAuthorized:raw.scale2_clinician_authorized===true});
 return {when,complete,news2};
}
router.post('/:stay_id/observations',auth,auth.requireRole('ER_STAFF','DOCTOR','ADMIN'),requireStayAccess(),async(req,res)=>{
 const stayId=Number(req.params.stay_id);if(!Number.isSafeInteger(stayId)||stayId<=0)return res.status(400).json({error:'Invalid stay_id'});
 let result;try{result=parseBody(req.body);}catch(e){return res.status(400).json({error:e.message,code:'VALIDATION_ERROR'});}
 const client=await pool.connect();let started=false;
 try{
  await client.query('BEGIN');started=true;
  const s=await client.query('SELECT stay_id FROM ed_stays WHERE stay_id=$1 FOR UPDATE',[stayId]);
  if(!s.rowCount){await client.query('ROLLBACK');started=false;return res.status(404).json({error:'Stay not found'});}
  const values=fields.map(k=>req.body[k]===undefined?null:req.body[k]);
  const saved=await client.query(`INSERT INTO public.er_vital_entries
    (stay_id,recorded_by,observation_time,heart_rate,respiratory_rate,systolic_bp,diastolic_bp,spo2,temperature_celsius,consciousness,oxygen_support,spo2_scale,scoring_status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [stayId,req.user.user_id,result.when,...values,result.complete?'COMPLETED':'PENDING_INPUTS']);
  // Preserve partially recorded inputs without generating a clinically misleading score.
  // The new entry remains separate from the legacy imported observations table.
  let news2=null;
  if(result.complete){
   const score=result.news2;
   await client.query(`UPDATE public.er_vital_entries SET news2_score=$2,risk_level=$3 WHERE entry_id=$1`,[saved.rows[0].entry_id,score.total_news2_score,score.risk_level]);
   news2=score;
  }
  await client.query('COMMIT');started=false;
  res.status(201).json({message:'Vital entry recorded',observation:saved.rows[0],news2,processing:{status:result.complete?'COMPLETED':'PENDING_INPUTS',legacy_news2_board_updated:false}});
 }catch(e){if(started)await client.query('ROLLBACK');console.error('Vitals save error:',e.code||'DB_ERROR');res.status(500).json({error:'Unable to record vitals'});}finally{client.release();}
});
module.exports={router,parseBody};
