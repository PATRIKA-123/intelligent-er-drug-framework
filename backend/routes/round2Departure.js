'use strict';
const express=require('express');const pool=require('../db');const auth=require('../middleware/authMiddleware');const {requireStayAccess}=require('../services/accessPolicy');
const router=express.Router();
router.post('/:stay_id/departure',auth,auth.requireRole('ER_STAFF','ADMIN'),requireStayAccess('stay_id',{postEr:true}),async(req,res)=>{
 const id=Number(req.params.stay_id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid stay id'});
 const client=await pool.connect();let tx=false;
 try{await client.query('BEGIN');tx=true;
 const stay=await client.query('SELECT stay_id,departed_at FROM ed_stays WHERE stay_id=$1 FOR UPDATE',[id]);
 if(!stay.rowCount){await client.query('ROLLBACK');tx=false;return res.status(404).json({error:'Stay not found'});}
 if(stay.rows[0].departed_at){await client.query('ROLLBACK');tx=false;return res.status(409).json({error:'This patient is already marked as left'});}
 const d=await client.query('SELECT 1 FROM discharges WHERE stay_id=$1 LIMIT 1',[id]);
 if(!d.rowCount){await client.query('ROLLBACK');tx=false;return res.status(409).json({error:'The doctor has not authorized a discharge for this visit yet'});}
 const saved=await client.query(`UPDATE ed_stays SET visit_status='DEPARTED',departed_at=now(),departed_by=$2 WHERE stay_id=$1 RETURNING departed_at`,[id,req.user.user_id]);
 await client.query('COMMIT');tx=false;return res.json({message:'Departure recorded',departed_at:saved.rows[0].departed_at});
 }catch(e){if(tx)await client.query('ROLLBACK');console.error('Departure:',e.code||'DB_ERROR');res.status(500).json({error:'Unable to record departure'});}finally{client.release();}
});
module.exports=router;
