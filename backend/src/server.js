import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { authRoutes,authenticate,ready,schoolAccess,demoEnabled,session,cookie,hash } from './auth.js';
import { dataRoutes } from './data.js';
import { timetableRoutes } from './timetables.js';
import { documentRoutes,publicDocuments } from './documents.js';
import { fail } from './common.js';
const app=express();
const origin=process.env.FRONTEND_URL||'http://localhost:5174';
const allowedOrigin=value=>value===origin||(process.env.NODE_ENV!=='production'&&['http://localhost:5174','http://127.0.0.1:5174','http://127.0.0.1:4001'].includes(value));
if(process.env.TRUST_PROXY_HOPS)app.set('trust proxy',Number(process.env.TRUST_PROXY_HOPS));
app.use(helmet({crossOriginResourcePolicy:{policy:'same-origin'}}));
app.use(cors({origin:(o,cb)=>cb(null,!o||allowedOrigin(o)),credentials:true}));
app.use(express.json({limit:'1mb'}));
app.use((req,_res,next)=>{
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('X-KruHub')!=='1'||(req.get('Origin')&&!allowedOrigin(req.get('Origin')))))return next(Object.assign(new Error('คำขอนี้ไม่ผ่านการตรวจสอบ กรุณาโหลดหน้าใหม่'),{status:403}));next();
});
app.get('/api/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({status:'ok',service:'kruhub',timezone:'Asia/Bangkok'});}catch{res.status(503).json({status:'unavailable'});}});
app.use('/api/auth',authRoutes);
app.post('/api/auth/demo',rateLimit({windowMs:60000,limit:15}),async(_req,res)=>{
 if(!demoEnabled)fail(404,'ไม่เปิดใช้งานบัญชีตัวอย่าง');
 const [[user]]=await pool.query("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id JOIN schools s ON s.id=m.school_id WHERE u.username='demo.kruhub' AND u.active=TRUE AND m.active=TRUE AND s.code='kruhub-demo'");if(!user)fail(503,'ยังไม่ได้เตรียมโรงเรียนตัวอย่าง');await session(res,user.id);res.json({ok:true});
});
app.use('/api/schools/:schoolId',authenticate,ready,schoolAccess,dataRoutes,timetableRoutes,documentRoutes);
app.get('/api/media',authenticate,ready,async(req,res)=>{
 const [[teacher]]=await pool.query('SELECT s.id FROM staff s JOIN memberships m ON m.id=s.membership_id AND m.school_id=s.school_id WHERE m.user_id=? AND m.active=TRUE AND s.is_teacher=TRUE AND s.active=TRUE',[req.user.id]);if(!teacher&&!req.user.is_super_admin)fail(403,'คลังสื่อสำหรับคุณครูเท่านั้น');
 const [rows]=await pool.query('SELECT id,title,description,subject_name,grade_name,launch_path FROM media_catalog WHERE active=TRUE');res.json(rows);
});
app.use('/api/public/review',rateLimit({windowMs:60000,limit:120}),publicDocuments);
app.use('/api',(_req,res)=>res.status(404).json({error:'ไม่พบรายการที่เรียก'}));
app.use((error,_req,res,_next)=>{
 if(res.headersSent)return res.end();
 const known={ER_DUP_ENTRY:'ข้อมูลนี้มีอยู่แล้ว หรือมีคาบสอนชนกัน',ER_ROW_IS_REFERENCED_2:'รายการนี้ถูกใช้ในข้อมูลอื่น กรุณาตรวจข้อมูลที่เกี่ยวข้องก่อน',ER_NO_REFERENCED_ROW_2:'ข้อมูลอ้างอิงไม่ตรงโรงเรียน หรือยังไม่ได้กำหนดวิชาที่ครูสอนได้',ER_CHECK_CONSTRAINT_VIOLATED:'ข้อมูลไม่ตรงเงื่อนไข กรุณาตรวจวัน เวลา หรือจำนวนคาบ',LIMIT_FILE_SIZE:'ไฟล์ใหญ่เกิน 20 MB'};
 const message=error.status?error.message:known[error.code];
 if(!message)console.error('API error:',error.stack);
 res.status(error.status||(message?400:500)).json({error:message||'ระบบขัดข้อง กรุณาลองใหม่'});
});
const server=createServer(app);
const io=new Server(server,{cors:{origin:(o,cb)=>cb(null,!o||allowedOrigin(o)),credentials:true}});app.set('io',io);
io.use(async(socket,next)=>{
 try{const token=cookie(socket.request);if(!token)throw Error();const [[u]]=await pool.query('SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND u.active=TRUE AND u.must_change_password=FALSE',[hash(token)]);if(!u)throw Error();socket.userId=u.id;next();}catch{next(new Error('กรุณาเข้าสู่ระบบ'));}
});
io.on('connection',socket=>{socket.on('join:school',async schoolId=>{const [[m]]=await pool.query('SELECT m.id FROM memberships m JOIN schools s ON s.id=m.school_id WHERE m.user_id=? AND m.school_id=? AND m.active=TRUE AND s.active=TRUE',[socket.userId,Number(schoolId)]);const [[u]]=await pool.query('SELECT is_super_admin FROM users WHERE id=?',[socket.userId]);if(m||u?.is_super_admin)socket.join(`school:${Number(schoolId)}`);});});
server.listen(Number(process.env.PORT||4001),process.env.API_HOST||'127.0.0.1',()=>console.log('Kru-Hub API ready'));
let stopping=false;async function shutdown(){if(stopping)return;stopping=true;io.close();server.close();await pool.end();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
