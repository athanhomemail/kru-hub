import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { fail, text, id, transaction, audit } from './common.js';
export const hash = value => createHash('sha256').update(value).digest('hex');
const production = process.env.NODE_ENV === 'production';
export const demoEnabled = !production && process.env.ENABLE_DEMO_LOGIN === 'true';
export async function session(res, userId) {
 const token = randomBytes(32).toString('hex');
 await pool.query('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR))',[hash(token),userId]);
 res.cookie('kruhub_session',token,{httpOnly:true,secure:production,sameSite:'strict',maxAge:12*3600000,path:'/'});
}
export function cookie(req) { return (req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('kruhub_session='))?.slice(15); }
export async function authenticate(req, _res, next) {
 try {
  const token = cookie(req);
  if(!token) fail(401,'กรุณาเข้าสู่ระบบ');
  const [[user]] = await pool.query('SELECT u.id,u.username,u.display_name,u.is_super_admin,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND u.active=TRUE',[hash(token)]);
  if(!user) fail(401,'หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่');
  req.user=user;next();
 } catch(error){next(error);}
}
export function ready(req,_res,next) { if(req.user.must_change_password) return next(Object.assign(new Error('กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน'),{status:403})); next(); }
export async function schoolAccess(req,_res,next) {
 try {
 const schoolId=id(req.params.schoolId);
 const [[school]] = await pool.query('SELECT * FROM schools WHERE id=? AND active=TRUE',[schoolId]);
 if(!school) fail(404,'ไม่พบโรงเรียน');
 const [[member]] = await pool.query('SELECT m.*,s.id AS staff_id,s.is_teacher,s.department_id FROM memberships m LEFT JOIN staff s ON s.school_id=m.school_id AND s.membership_id=m.id AND s.active=TRUE WHERE m.school_id=? AND m.user_id=? AND m.active=TRUE',[schoolId,req.user.id]);
 if(!req.user.is_super_admin && !member) fail(403,'ไม่มีสิทธิ์เข้าถึงโรงเรียนนี้');
 req.school=school;req.member=member;next();
 }catch(error){next(error);}
}
export function admin(req) { if(!req.user.is_super_admin && req.member?.role!=='school_admin') fail(403,'เฉพาะผู้ดูแลโรงเรียน'); }
export function staffAccess(req) { if(!req.user.is_super_admin && !['school_admin','staff'].includes(req.member?.role)) fail(403,'เฉพาะบุคลากรโรงเรียน'); }
export const authRoutes=Router();
const limiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'ลองเข้าสู่ระบบมากเกินไป กรุณารอสักครู่'}});
authRoutes.get('/config',(_req,res)=>res.json({demo:demoEnabled}));
authRoutes.post('/login',limiter,async(req,res)=>{
 const username=text(req.body.username,100), password=text(req.body.password,200);
 const [[user]]=await pool.query('SELECT * FROM users WHERE username=? AND active=TRUE',[username]);
 if(!user || !await bcrypt.compare(password,user.password_hash)) fail(401,'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
 await session(res,user.id);res.json({ok:true});
});
authRoutes.post('/logout',authenticate,async(req,res)=>{await pool.query('DELETE FROM sessions WHERE token_hash=?',[hash(cookie(req))]);res.clearCookie('kruhub_session',{path:'/',secure:production,sameSite:'strict'});res.json({ok:true});});
authRoutes.get('/me',authenticate,async(req,res)=>{
 const [schools]=await pool.query(req.user.is_super_admin?'SELECT s.*, "super_admin" AS role FROM schools s WHERE active=TRUE':'SELECT s.*,m.role FROM schools s JOIN memberships m ON m.school_id=s.id WHERE m.user_id=? AND m.active=TRUE AND s.active=TRUE',req.user.is_super_admin?[]:[req.user.id]);
 res.json({user:req.user,schools});
});
authRoutes.post('/password',authenticate,async(req,res)=>{
 const password=text(req.body.password,200);if(password.length<6) fail(400,'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
 const [[user]]=await pool.query('SELECT password_hash FROM users WHERE id=?',[req.user.id]);
 if(!await bcrypt.compare(text(req.body.current,200),user.password_hash)) fail(400,'รหัสผ่านเดิมไม่ถูกต้อง');
 const passwordHash=await bcrypt.hash(password,12);
 await transaction(async c=>{await c.query('UPDATE users SET password_hash=?,must_change_password=FALSE WHERE id=?',[passwordHash,req.user.id]);await c.query('DELETE FROM sessions WHERE user_id=?',[req.user.id]);});
 await session(res,req.user.id);res.json({ok:true});
});
authRoutes.post('/schools',authenticate,ready,async(req,res)=>{
 if(!req.user.is_super_admin) fail(403,'เฉพาะเจ้าของระบบ');
 const schoolId=await transaction(async c=>{
 const [r]=await c.query('INSERT INTO schools (code,name) VALUES (?,?)',[text(req.body.code,40),text(req.body.name)]);
 await audit(c,req,'create','school',r.insertId);return r.insertId;
 });res.status(201).json({id:schoolId});
});
