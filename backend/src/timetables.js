import { Router } from 'express';
import { Worker } from 'node:worker_threads';
import { pool } from './db.js';
import { fail,id,transaction,audit } from './common.js';
import { staffAccess } from './auth.js';
import { canCoordinate,loadData } from './data.js';
import { placementError,readiness,previewMove,isLockedEntry } from './scheduler.js';
import {exportModel,excelExport,pdfExport} from './timetable-export.js';
export const timetableRoutes=Router({mergeParams:true});
async function stateFor(req,c,versionId,lock=false){
 if(lock){const [[reference]]=await c.query('SELECT term_id FROM timetable_versions WHERE school_id=? AND id=?',[req.school.id,id(versionId)]);if(!reference)fail(404,'ไม่พบตาราง');await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,reference.term_id]);}
 const [[v]]=await c.query(`SELECT * FROM timetable_versions WHERE school_id=? AND id=? ${lock?'FOR UPDATE':''}`,[req.school.id,id(versionId)]);if(!v)fail(404,'ไม่พบตาราง');
 const data=await loadData(req.school.id,c);
 const [entries]=await c.query('SELECT * FROM timetable_entries WHERE school_id=? AND version_id=?',[req.school.id,v.id]);
 const subjects=new Map(data.subjects.map(s=>[Number(s.id),s]));
 const requirements=data.teaching_requirements.filter(r=>Number(r.term_id)===Number(v.term_id)).map(r=>({...r,subject_name:subjects.get(Number(r.subject_id))?.name}));
 return {version:v,slots:data.teaching_slots.filter(s=>Number(s.term_id)===Number(v.term_id)),requirements,classroomSlots:data.classroom_slots.filter(s=>Number(s.term_id)===Number(v.term_id)),classrooms:data.classrooms.filter(room=>Number(room.academic_year_id)===Number(data.terms.find(t=>Number(t.id)===Number(v.term_id))?.academic_year_id)),unavailable:data.teacher_unavailability.filter(s=>Number(s.term_id)===Number(v.term_id)),entries};
}
function draft(req,state){
 if(state.version.status!=='draft')fail(400,'ตารางนี้เผยแพร่แล้ว กรุณาสร้างฉบับร่างใหม่');
 if(Number(req.body.revision)!==Number(state.version.revision))fail(409,'มีผู้แก้ตารางแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนทำต่อ');
}
async function insertEntry(c,req,state,entry){
 const [r]=await c.query('INSERT INTO timetable_entries(school_id,term_id,version_id,classroom_id,requirement_id,teacher_id,slot_id,source,locked) VALUES (?,?,?,?,?,?,?,?,?)',[req.school.id,state.version.term_id,state.version.id,entry.classroom_id,entry.requirement_id,entry.teacher_id,entry.slot_id,entry.source,entry.locked]);return r.insertId;
}
async function changed(c,req,state,action){await c.query('UPDATE timetable_versions SET revision=revision+1 WHERE id=?',[state.version.id]);await audit(c,req,action,'timetable',state.version.id);}
function notify(req){req.app.get('io')?.to(`school:${req.school.id}`).emit('timetable:changed',{schoolId:req.school.id});}
timetableRoutes.get('/timetables',async(req,res)=>{staffAccess(req);const [rows]=await pool.query('SELECT * FROM timetable_versions WHERE school_id=? ORDER BY id DESC',[req.school.id]);res.json(rows);});
timetableRoutes.post('/timetables',async(req,res)=>{
 const term=id(req.body.term_id);const [rooms]=await pool.query('SELECT c.id FROM classrooms c JOIN terms t ON t.school_id=c.school_id AND t.academic_year_id=c.academic_year_id WHERE c.school_id=? AND t.id=?',[req.school.id,term]);
 // Coordinators can create a school-wide draft; only their grade can be edited afterward.
 staffAccess(req);if(!req.user.is_super_admin&&req.member?.role!=='school_admin'){const [allowed]=await pool.query('SELECT * FROM grade_coordinators WHERE school_id=? AND term_id=? AND staff_id=?',[req.school.id,term,req.member?.staff_id||0]);if(!allowed.length)fail(403,'คุณยังไม่ได้รับสิทธิ์จัดตาราง');}
 const versionId=await transaction(async c=>{
 const [[t]]=await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,term]);if(!t)fail(404,'ไม่พบภาคเรียน');
 const [result]=await c.query('INSERT INTO timetable_versions(school_id,term_id,created_by) VALUES (?,?,?)',[req.school.id,term,req.user.id]);
 const [[old]]=await c.query("SELECT id FROM timetable_versions WHERE school_id=? AND term_id=? AND status='published'",[req.school.id,term]);
 if(req.body.empty&&!req.user.is_super_admin&&req.member?.role!=='school_admin')fail(403,'เฉพาะผู้ดูแลสร้างร่างเปล่าทั้งโรงเรียนได้');
 if(old&&!req.body.empty)await c.query('INSERT INTO timetable_entries(school_id,term_id,version_id,classroom_id,requirement_id,teacher_id,slot_id,source,locked) SELECT school_id,term_id,?,classroom_id,requirement_id,teacher_id,slot_id,source,locked FROM timetable_entries WHERE school_id=? AND version_id=?',[result.insertId,req.school.id,old.id]);
 await audit(c,req,'create','timetable',result.insertId);return result.insertId;
 });res.status(201).json({id:versionId});
});
timetableRoutes.get('/timetables/:id',async(req,res)=>{staffAccess(req);res.json(await stateFor(req,pool,req.params.id));});
timetableRoutes.post('/timetables/:id/placement',async(req,res)=>{
 await transaction(async c=>{
 const s=await stateFor(req,c,req.params.id,true);draft(req,s);
 const r=s.requirements.find(r=>Number(r.id)===id(req.body.requirement_id));const slot=s.slots.find(slot=>Number(slot.id)===id(req.body.slot_id));if(!r||!slot)fail(400,'วิชาหรือคาบไม่ถูกต้อง');
 await canCoordinate(req,s.version.term_id,[r.classroom_id],c);
 const error=placementError(s,s.entries,r,slot,req.body.free===true);if(error)fail(400,error);
 await insertEntry(c,req,s,{classroom_id:r.classroom_id,requirement_id:r.id,teacher_id:r.teacher_id,slot_id:slot.id,source:'manual',locked:1});await changed(c,req,s,'manual');
 });notify(req);res.json({ok:true});
});
timetableRoutes.post('/timetables/:id/move',async(req,res)=>{
 await transaction(async c=>{
 const s=await stateFor(req,c,req.params.id,true);draft(req,s);
 const source=s.entries.find(e=>Number(e.id)===id(req.body.entry_id)),target=s.slots.find(slot=>Number(slot.id)===id(req.body.slot_id));if(!source||!target)fail(400,'ไม่พบคาบที่ต้องการย้าย');
 await canCoordinate(req,s.version.term_id,[source.classroom_id],c);
 if(Number(source.slot_id)===Number(target.id))return;
 const preview=previewMove(s,source.id,target.id,req.body.free===true);if(preview.error)fail(400,preview.error);
 const {destination,moves}=preview;
 await c.query('DELETE FROM timetable_entries WHERE school_id=? AND version_id=? AND id IN (?)',[req.school.id,s.version.id,[source.id,...(destination?[destination.id]:[])]]);
 for(const entry of moves)await insertEntry(c,req,s,entry);await changed(c,req,s,'move');
 });notify(req);res.json({ok:true});
});
timetableRoutes.post('/timetables/:id/entries/:entryId/unlock',async(req,res)=>{
 await transaction(async c=>{
 const s=await stateFor(req,c,req.params.id,true);draft(req,s);
 const entry=s.entries.find(e=>Number(e.id)===id(req.params.entryId));if(!entry)fail(404,'ไม่พบคาบ');
 await canCoordinate(req,s.version.term_id,[entry.classroom_id],c);
 if(!isLockedEntry(entry))return;
 // An explicitly released lesson joins Auto; manual entries must remain locked by schema.
 await c.query("UPDATE timetable_entries SET source='auto',locked=FALSE WHERE school_id=? AND version_id=? AND id=?",[req.school.id,s.version.id,entry.id]);
 await changed(c,req,s,'unlock');
 });notify(req);res.json({ok:true});
});
timetableRoutes.delete('/timetables/:id/entries/:entryId',async(req,res)=>{
 await transaction(async c=>{const s=await stateFor(req,c,req.params.id,true);draft(req,s);const entry=s.entries.find(e=>Number(e.id)===id(req.params.entryId));if(!entry)fail(404,'ไม่พบคาบ');if(isLockedEntry(entry))fail(400,'คาบนี้ถูกล็อก ห้ามลบหรือเปลี่ยนตำแหน่ง');await canCoordinate(req,s.version.term_id,[entry.classroom_id],c);await c.query('DELETE FROM timetable_entries WHERE school_id=? AND id=?',[req.school.id,entry.id]);await changed(c,req,s,'remove');});notify(req);res.json({ok:true});
});
timetableRoutes.post('/timetables/:id/auto',async(req,res)=>{
 const result=await transaction(async c=>{
 const s=await stateFor(req,c,req.params.id,true);draft(req,s);const rooms=(req.body.room_ids||[]).map(id);
 if(rooms.some(r=>!s.classrooms.some(c=>Number(c.id)===r)))fail(400,'ไม่พบห้องเรียน');
 await canCoordinate(req,s.version.term_id,rooms,c);const problems=readiness(s,rooms);if(problems.length)fail(400,problems.join(' · '));
 const solved=await new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('./scheduler-worker.js',import.meta.url),{execArgv:[],workerData:{state:s,roomIds:rooms}});
 const timer=setTimeout(()=>{worker.terminate();reject(Object.assign(new Error('จัดตารางใช้เวลานานเกินไป กรุณาลองใหม่'),{status:503}));},10000);
 worker.on('message',value=>{if(value?.kind==='result'){clearTimeout(timer);resolve(value.result);}});worker.once('error',error=>{clearTimeout(timer);reject(error);});worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(new Error('Scheduler worker stopped'));}});
 });
 await c.query("DELETE FROM timetable_entries WHERE school_id=? AND version_id=? AND classroom_id IN (?) AND source='auto' AND locked=FALSE",[req.school.id,s.version.id,rooms]);
 for(const entry of solved.entries.filter(e=>!e.id))await insertEntry(c,req,s,entry);
 await changed(c,req,s,'auto');return {complete:solved.complete,remaining:solved.remaining,search:solved.search};
 });notify(req);res.json(result);
});
timetableRoutes.post('/timetables/:id/clear-auto',async(req,res)=>{
 await transaction(async c=>{const s=await stateFor(req,c,req.params.id,true);draft(req,s);const rooms=(req.body.room_ids||[]).map(id);if(!rooms.length)fail(400,'เลือกห้องก่อน');await canCoordinate(req,s.version.term_id,rooms,c);await c.query("DELETE FROM timetable_entries WHERE school_id=? AND version_id=? AND classroom_id IN (?) AND source='auto' AND locked=FALSE",[req.school.id,s.version.id,rooms]);await changed(c,req,s,'clear_auto');});notify(req);res.json({ok:true});
});
timetableRoutes.post('/timetables/:id/publish',async(req,res)=>{
 if(!req.user.is_super_admin&&req.member?.role!=='school_admin')fail(403,'ผู้ดูแลโรงเรียนเป็นผู้เผยแพร่ตาราง');
 await transaction(async c=>{
 const [[v]]=await c.query('SELECT term_id FROM timetable_versions WHERE school_id=? AND id=?',[req.school.id,id(req.params.id)]);if(!v)fail(404,'ไม่พบตาราง');
 await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,v.term_id]);
 const s=await stateFor(req,c,req.params.id,true);draft(req,s);
 const rooms=s.classrooms.map(room=>Number(room.id));const problems=readiness(s,rooms);if(problems.length)fail(400,problems.join(' · '));
 if(s.requirements.some(r=>s.entries.filter(e=>Number(e.requirement_id)===Number(r.id)).length!==r.periods_per_week))fail(400,'ยังมีวิชาที่จัดไม่ครบ กรุณาจัดให้ครบก่อนเผยแพร่');
 await c.query("UPDATE timetable_versions SET status='archived' WHERE school_id=? AND term_id=? AND status='published'",[req.school.id,s.version.term_id]);
 await c.query("UPDATE timetable_versions SET status='published',published_at=UTC_TIMESTAMP(),revision=revision+1 WHERE id=?",[s.version.id]);await audit(c,req,'publish','timetable',s.version.id);
 });notify(req);res.json({ok:true});
});
timetableRoutes.get('/timetables/:id/export',async(req,res)=>{
 staffAccess(req);const s=await stateFor(req,pool,req.params.id);const data=await loadData(req.school.id);
 const csv=(v)=>`"${String(v??'').replace(/^[=+\-@]/,"'$&").replaceAll('"','""')}"`;
 const rows=[['ห้อง','วัน','คาบ','เริ่ม','จบ','วิชา','ครู','วิธีจัด'],...s.entries.map(e=>{const slot=s.slots.find(s=>s.id===e.slot_id),r=s.requirements.find(r=>r.id===e.requirement_id);return [s.classrooms.find(c=>c.id===e.classroom_id)?.name,['','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'][slot.weekday],slot.period_number,slot.starts_at,slot.ends_at,r.subject_name,data.staff.find(t=>t.id===e.teacher_id)?.display_name,e.source];})];
 res.set('Content-Type','text/csv; charset=utf-8').attachment('kruhub-timetable.csv').send('\uFEFF'+rows.map(r=>r.map(csv).join(',')).join('\r\n'));
});
timetableRoutes.get('/timetables/:id/download',async(req,res)=>{
 staffAccess(req);
 if(!['pdf','xlsx'].includes(req.query.format))fail(400,'เลือกรูปแบบ PDF หรือ Excel');
 const c=await pool.getConnection();let model;
 try{
  // Read a consistent revision even if someone edits the timetable during export.
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');
  const state=await stateFor(req,c,req.params.id);const data=await loadData(req.school.id,c);
  model=exportModel(state,data,req.school,req.query);await c.commit();
 }catch(error){await c.rollback();throw error;}finally{c.release();}
 const pdf=req.query.format==='pdf';const buffer=await (pdf?pdfExport(model):excelExport(model));
 res.set('Cache-Control','private, no-store');res.type(pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 res.attachment(`kruhub-${model.view}-${model.version}.${pdf?'pdf':'xlsx'}`).send(buffer);
});
timetableRoutes.post('/timetables/:id/bulk-placement',async(req,res)=>{
 await transaction(async c=>{
 const s=await stateFor(req,c,req.params.id,true);draft(req,s);const rooms=(req.body.room_ids||[]).map(id);if(!rooms.length)fail(400,'กรุณาเลือกห้องเรียน');
 await canCoordinate(req,s.version.term_id,rooms,c);const slot=s.slots.find(slot=>Number(slot.id)===id(req.body.slot_id));if(!slot)fail(400,'ไม่พบคาบเรียน');
 const entries=[...s.entries],pending=[];
 for(const room of rooms){const matches=s.requirements.filter(r=>Number(r.classroom_id)===room&&Number(r.subject_id)===id(req.body.subject_id));if(matches.length>1)fail(400,`${s.classrooms.find(c=>Number(c.id)===room)?.name||'ห้องเรียน'} แบ่งวิชานี้ให้หลายครู กรุณาลงคาบแยกห้องโดยเลือกครูให้ชัดเจน`);const r=matches[0];if(!r)fail(400,`${s.classrooms.find(c=>Number(c.id)===room)?.name||'ห้องเรียน'} ยังไม่ได้กำหนดวิชานี้`);const error=placementError(s,entries,r,slot,req.body.free===true);if(error)fail(400,`${s.classrooms.find(c=>Number(c.id)===room)?.name}: ${error}`);const entry={classroom_id:r.classroom_id,requirement_id:r.id,teacher_id:r.teacher_id,slot_id:slot.id,source:'manual',locked:1};entries.push(entry);pending.push(entry);}
 for(const entry of pending)await insertEntry(c,req,s,entry);await changed(c,req,s,'bulk_manual');
 });notify(req);res.json({ok:true});
});
