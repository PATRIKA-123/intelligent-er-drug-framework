const jwt = require('jsonwebtoken');
const pool = require('../db');
// Archived accounts remain in the database for medical attribution, but may
// never authenticate even if another workflow toggles is_active back to true.
async function loadCurrentUser(userId) {
 const r=await pool.query('SELECT user_id,username,role,is_active,archived_at FROM public.users WHERE user_id=$1',[userId]);
 return r.rows[0]||null;
}
const authMiddleware=async(req,res,next)=>{
 let decoded;
 try {
  const h=req.headers.authorization;
  if(!h||!h.startsWith('Bearer '))return res.status(401).json({error:'Authentication token required'});
  const token=h.slice(7).trim();if(!token)return res.status(401).json({error:'Authentication token required'});
  decoded=jwt.verify(token,process.env.JWT_SECRET);
 }catch(e){return res.status(401).json({error:'Invalid or expired token'});}
 const id=Number(decoded.user_id);
 if(!Number.isSafeInteger(id)||id<=0||!/^\d+$/.test(String(decoded.user_id)))return res.status(401).json({error:'Invalid or expired token'});
 let current;
 try{current=await authMiddleware.lookupUser(id);}catch(e){console.error('Account verification:',e.code||'DATABASE_ERROR');return res.status(503).json({error:'Unable to verify your account right now. Please try again.'});}
 if(!current)return res.status(401).json({error:'Invalid or expired token'});
 if(!current.is_active||current.archived_at)return res.status(401).json({error:'This account is no longer active'});
 req.user={...decoded,user_id:current.user_id,username:current.username,role:current.role};
 return next();
};
const requireRole=(...roles)=>(req,res,next)=>{
 if(!req.user)return res.status(401).json({error:'Not authenticated'});
 if(!roles.includes(req.user.role))return res.status(403).json({error:"You don't have permission to access this resource"});
 return next();
};
authMiddleware.requireRole=requireRole;
authMiddleware.lookupUser=loadCurrentUser;
module.exports=authMiddleware;
