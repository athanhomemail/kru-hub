import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import {extractWordText} from './word.js';
import { randomBytes } from 'node:crypto';
import { mkdir,readFile,unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from './db.js';
import { fail,id,text,transaction,audit } from './common.js';
import { staffAccess,hash } from './auth.js';
export const storage=resolve(process.env.UPLOAD_DIR || '../uploads');
await mkdir(storage,{recursive:true});
const wordMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const upload=multer({dest:storage,limits:{fileSize:20*1024*1024,files:1},fileFilter:(_req,file,cb)=>cb(null,['application/pdf','image/png','image/jpeg',wordMime].includes(file.mimetype))});
export const documentRoutes=Router({mergeParams:true});
export const publicDocuments=Router();
const select='SELECT p.*,s.display_name AS teacher_name,s.department_id,d.name AS department_name,sub.name AS subject_name,g.name AS grade_name FROM lesson_plans p JOIN staff s ON s.school_id=p.school_id AND s.id=p.staff_id LEFT JOIN departments d ON d.school_id=s.school_id AND d.id=s.department_id JOIN subjects sub ON sub.school_id=p.school_id AND sub.id=p.subject_id JOIN grade_levels g ON g.school_id=p.school_id AND g.id=p.grade_level_id';
documentRoutes.get('/documents',async(req,res)=>{staffAccess(req);const [rows]=await pool.query(`${select} WHERE p.school_id=? ORDER BY p.lesson_date DESC,p.id DESC`,[req.school.id]);res.json(rows.map(({file_key,...row})=>row));});
documentRoutes.post('/documents',(req,_res,next)=>{try{staffAccess(req);next();}catch(e){next(e);}},upload.single('file'),async(req,res)=>{
 let saved=false;
 try {
 if(!req.file)fail(400,'รองรับ PDF, Word .docx, PNG และ JPEG ขนาดไม่เกิน 20 MB');
 const bytes=await readFile(req.file.path);
 const isWord=req.file.mimetype===wordMime&&bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]));
 let previewText=null;if(isWord)previewText=await extractWordText(bytes);
 const isPdf=bytes.subarray(0,5).toString()==='%PDF-',isPng=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),isJpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!(isWord||(isPdf&&req.file.mimetype==='application/pdf')||(isPng&&req.file.mimetype==='image/png')||(isJpg&&req.file.mimetype==='image/jpeg')))fail(400,'เนื้อหาไฟล์ไม่ตรงประเภทที่ระบุ');
 const teacher=id(req.body.staff_id||req.member?.staff_id);
 if(!req.user.is_super_admin&&req.member?.role!=='school_admin'&&Number(req.member?.staff_id)!==teacher)fail(403,'อัปโหลดได้เฉพาะแผนการสอนของตนเอง');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(req.body.lesson_date))fail(400,'เลือกวันที่แผนการสอน');
 const recordId=await transaction(async c=>{
 const [r]=await c.query('INSERT INTO lesson_plans(school_id,staff_id,subject_id,grade_level_id,term_id,title,lesson_date,file_key,original_name,mime_type,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[req.school.id,teacher,id(req.body.subject_id),id(req.body.grade_level_id),id(req.body.term_id),text(req.body.title),req.body.lesson_date,req.file.filename,text(req.file.originalname),req.file.mimetype,req.file.size]);
 if(previewText!==null)await c.query('INSERT INTO document_previews(plan_id,preview_text) VALUES (?,?)',[r.insertId,previewText]);
 await audit(c,req,'upload','lesson_plan',r.insertId);return r.insertId;
 });saved=true;res.status(201).json({id:recordId});
 } finally {if(req.file&&!saved)await unlink(req.file.path).catch(()=>{});}
});
async function sendPlan(res,plan,download=false){
 if(plan.mime_type===wordMime&&!download){const [[preview]]=await pool.query('SELECT preview_text FROM document_previews WHERE plan_id=?',[plan.id]);return res.set('Cache-Control','private, no-store').json({text:preview?.preview_text||'ไม่พบข้อความในเอกสาร'});}
 res.type(plan.mime_type).set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff');
 if(download)res.attachment(plan.original_name);
 else res.set('Content-Disposition','inline');
 await new Promise((resolvePromise,reject)=>res.sendFile(resolve(storage,plan.file_key),error=>error?reject(error):resolvePromise()));
}
documentRoutes.get('/documents/:id/file',async(req,res)=>{staffAccess(req);const [[p]]=await pool.query('SELECT * FROM lesson_plans WHERE school_id=? AND id=?',[req.school.id,id(req.params.id)]);if(!p)fail(404,'ไม่พบเอกสาร');await sendPlan(res,p,req.query.download==='1');});
documentRoutes.delete('/documents/:id',async(req,res)=>{
 staffAccess(req);const plan=await transaction(async c=>{
 const [[p]]=await c.query('SELECT * FROM lesson_plans WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,id(req.params.id)]);if(!p)fail(404,'ไม่พบเอกสาร');
 if(!req.user.is_super_admin&&req.member?.role!=='school_admin'&&Number(p.staff_id)!==Number(req.member?.staff_id))fail(403,'ลบได้เฉพาะเอกสารของตนเอง');
 await c.query('DELETE FROM lesson_plans WHERE id=?',[p.id]);await audit(c,req,'delete','lesson_plan',p.id);return p;
 });await unlink(resolve(storage,plan.file_key)).catch(()=>{});res.json({ok:true});
});
documentRoutes.get('/shares',async(req,res)=>{
 staffAccess(req);const isAdmin=req.user.is_super_admin||req.member?.role==='school_admin';
 const [rows]=await pool.query(`SELECT id,department_id,expires_at,revoked,created_at FROM document_shares WHERE school_id=? ${isAdmin?'':'AND created_by=?'} ORDER BY id DESC`,isAdmin?[req.school.id]:[req.school.id,req.user.id]);res.json(rows);
});
documentRoutes.post('/shares',async(req,res)=>{
 staffAccess(req);const isAdmin=req.user.is_super_admin||req.member?.role==='school_admin';
 const department=isAdmin?(req.body.department_id?id(req.body.department_id):null):req.member?.department_id;
 if(!isAdmin&&!department)fail(400,'กรุณากำหนดหมวดวิชาของคุณก่อน');
 const days=Number(req.body.days||7);if(!Number.isInteger(days)||days<1||days>30)fail(400,'ลิงก์มีอายุ 1–30 วัน');
 const token=randomBytes(32).toString('hex');
 const record=await transaction(async c=>{const [r]=await c.query('INSERT INTO document_shares(school_id,department_id,token_hash,created_by,expires_at) VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? DAY))',[req.school.id,department,hash(token),req.user.id,days]);await audit(c,req,'share','document_share',r.insertId);return r.insertId;});
 const base=process.env.FRONTEND_URL||'http://localhost:5174';
 const url=`${base}/review/${token}`;
 res.status(201).json({id:record,url,qr:await QRCode.toDataURL(url,{width:320,margin:2,color:{dark:'#513040',light:'#ffffff'}})});
});
documentRoutes.delete('/shares/:id',async(req,res)=>{
 staffAccess(req);const isAdmin=req.user.is_super_admin||req.member?.role==='school_admin';
 const [r]=await pool.query(`UPDATE document_shares SET revoked=TRUE WHERE school_id=? AND id=? ${isAdmin?'':'AND created_by=?'}`,isAdmin?[req.school.id,id(req.params.id)]:[req.school.id,id(req.params.id),req.user.id]);if(!r.affectedRows)fail(404,'ไม่พบลิงก์');res.json({ok:true});
});
async function share(token){
 if(!/^[a-f0-9]{64}$/.test(token))fail(404,'ลิงก์ไม่ถูกต้อง');
 const [[s]]=await pool.query('SELECT ds.*,sc.name AS school_name FROM document_shares ds JOIN schools sc ON sc.id=ds.school_id AND sc.active=TRUE WHERE ds.token_hash=? AND ds.revoked=FALSE AND ds.expires_at>UTC_TIMESTAMP()',[hash(token)]);if(!s)fail(404,'ลิงก์หมดอายุหรือถูกยกเลิก');return s;
}
publicDocuments.get('/:token',async(req,res)=>{
 const s=await share(req.params.token);const [documents]=await pool.query(`${select} WHERE p.school_id=? ${s.department_id?'AND s.department_id=?':''} ORDER BY p.lesson_date DESC`,s.department_id?[s.school_id,s.department_id]:[s.school_id]);
 res.set('Cache-Control','no-store').json({school:s.school_name,expires_at:s.expires_at,documents:documents.map(({file_key,school_id,staff_id,...p})=>p)});
});
publicDocuments.get('/:token/documents/:id/preview',async(req,res)=>{
 const s=await share(req.params.token);
 const [[p]]=await pool.query(`${select} WHERE p.school_id=? AND p.id=? ${s.department_id?'AND s.department_id=?':''}`,s.department_id?[s.school_id,id(req.params.id),s.department_id]:[s.school_id,id(req.params.id)]);if(!p)fail(404,'ไม่พบเอกสาร');await sendPlan(res,p);
});
