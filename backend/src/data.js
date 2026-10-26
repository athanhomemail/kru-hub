import {ensureRoomsOpen} from './grade-workflow.js';
import {insertSlotBatch,setupFields} from './school-setup.js';
import {saveSubjectGrades,validateSubjectGrade,curriculumItems,applyCurriculum} from './curriculum.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from './db.js';
import { fail,id,text,transaction,audit } from './common.js';
import { admin,staffAccess } from './auth.js';
export const dataRoutes=Router({mergeParams:true});
const entities={
 departments:['name'],grade_levels:['name','sort_order','abbreviation'],subjects:['code','name','department_id'],
 staff:['code','display_name','department_id','is_teacher'],
 academic_years:['buddhist_year','starts_on','ends_on','status'],
 terms:['academic_year_id','term_number','starts_on','ends_on'],
 classrooms:['academic_year_id','grade_level_id','name','homeroom_teacher_id','room_number'],
 teaching_slots:['term_id','weekday','period_number','starts_at','ends_at'],
 students:['code','display_name'],school_holidays:['holiday_date','name']
};
const optional=new Set(['department_id','homeroom_teacher_id']);
function fields(entity,body){return entities[entity].map(k=>{
 const value=body[k];if(['abbreviation','room_number'].includes(k))return value==null||String(value).trim()===''?null:text(value,20);if(entity==='staff'&&k==='code')return value==null||String(value).trim()===''?null:text(value,40);
 if(optional.has(k)&&(!value||value===''))return null;
 if(k==='sort_order')return Number(value||0);
 if(k==='is_teacher')return value===false||value==='0'?0:1;
 if(k==='status'){if(!['active','planning','archived'].includes(value))fail(400,'สถานะไม่ถูกต้อง');return value;}
 if(k.endsWith('_id')||['buddhist_year','term_number','weekday','period_number'].includes(k))return id(value);
 if(k.endsWith('_on')||k.endsWith('_date')){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(400,'วันที่ไม่ถูกต้อง');}
 if(k.endsWith('_at')){if(!/^\d{2}:\d{2}(:\d{2})?$/.test(value))fail(400,'เวลาไม่ถูกต้อง');}
 return text(value);
});}
export async function loadData(schoolId,c=pool){
 const data={};
 for(const entity of Object.keys(entities)) [data[entity]]=await c.query(`SELECT * FROM ${entity} WHERE school_id=? ORDER BY ${entity==='grade_levels'?'sort_order,id':'id'}`,[schoolId]);
 for(const entity of ['teacher_subjects','classroom_slots','teaching_requirements','teacher_unavailability','grade_coordinators','enrollments','subject_grades','grade_curriculum']) [data[entity]]=await c.query(`SELECT * FROM ${entity} WHERE school_id=?`,[schoolId]);
 return data;
}
dataRoutes.get('/data',async(req,res)=>{staffAccess(req);res.json({...await loadData(req.school.id),member:req.member});});
dataRoutes.post('/data/:entity',async(req,res)=>{
 admin(req); const entity=req.params.entity;if(!entities[entity])fail(404,'ไม่พบประเภทข้อมูล');
 const record=await transaction(async c=>{
 const body=await setupFields(c,req.school.id,entity,req.body,true);
 const vals=fields(entity,body);
 if(entity==='teaching_slots'){
  const [conflicts]=await c.query('SELECT id FROM teaching_slots WHERE school_id=? AND term_id=? AND weekday=? AND starts_at<? AND ends_at>?',[req.school.id,req.body.term_id,req.body.weekday,req.body.ends_at,req.body.starts_at]);
  if(conflicts.length)fail(400,'เวลาเรียนคาบนี้ทับกับคาบอื่น');
 }
 const [r]=await c.query(`INSERT INTO ${entity}(school_id,${entities[entity].join(',')}) VALUES (${Array(vals.length+1).fill('?').join(',')})`,[req.school.id,...vals]);
 if(entity==='subjects')await saveSubjectGrades(c,req.school.id,r.insertId,req.body.grade_level_ids||[]);
 await audit(c,req,'create',entity,r.insertId);
 return r.insertId;
 });res.status(201).json({id:record});
});
dataRoutes.put('/data/:entity/:id',async(req,res)=>{
 admin(req);const entity=req.params.entity;if(!entities[entity])fail(404,'ไม่พบประเภทข้อมูล');
 await transaction(async c=>{
 const recordId=id(req.params.id);const [[record]]=await c.query(`SELECT * FROM ${entity} WHERE id=? AND school_id=? FOR UPDATE`,[recordId,req.school.id]);if(!record)fail(404,'ไม่พบข้อมูล');
 if(['classrooms','teaching_slots','terms'].includes(entity)){
  const [entries]=await c.query(`SELECT id FROM timetable_entries WHERE school_id=? AND ${entity==='classrooms'?'classroom_id':entity==='teaching_slots'?'slot_id':'term_id'}=? LIMIT 1`,[req.school.id,recordId]);
  if(entries.length)fail(400,'ข้อมูลนี้มีตารางสอนแล้ว กรุณาสร้างรายการใหม่เพื่อรักษาตารางเดิม');
 }
 const body=await setupFields(c,req.school.id,entity,{...record,...req.body});
 if(entity==='teaching_slots'){
 const [conflicts]=await c.query('SELECT id FROM teaching_slots WHERE school_id=? AND term_id=? AND weekday=? AND starts_at<? AND ends_at>? AND id<>?',[req.school.id,body.term_id,body.weekday,body.ends_at,body.starts_at,recordId]);if(conflicts.length)fail(400,'เวลาเรียนทับกับคาบอื่น');
 }
 await c.query(`UPDATE ${entity} SET ${entities[entity].map(k=>`${k}=?`).join(',')} WHERE id=? AND school_id=?`,[...fields(entity,body),recordId,req.school.id]);if(entity==='subjects'&&req.body.grade_level_ids!==undefined)await saveSubjectGrades(c,req.school.id,recordId,req.body.grade_level_ids);await audit(c,req,'update',entity,recordId);
 });res.json({ok:true});
});
dataRoutes.delete('/data/:entity/:id',async(req,res)=>{
 admin(req);const entity=req.params.entity;if(!entities[entity])fail(404,'ไม่พบประเภทข้อมูล');
 await transaction(async c=>{const [r]=await c.query(`DELETE FROM ${entity} WHERE school_id=? AND id=?`,[req.school.id,id(req.params.id)]);if(!r.affectedRows)fail(404,'ไม่พบข้อมูล');await audit(c,req,'delete',entity,id(req.params.id));});res.json({ok:true});
});
dataRoutes.put('/teachers/:id/subjects',async(req,res)=>{
 admin(req); const teacher=id(req.params.id);const subjects=(req.body.subjects||[]).map(id);
 await transaction(async c=>{
 const [[r]]=await c.query('SELECT id FROM staff WHERE school_id=? AND id=? AND is_teacher=TRUE',[req.school.id,teacher]);if(!r)fail(400,'ไม่พบครู');
 const [current]=await c.query('SELECT subject_id FROM teacher_subjects WHERE school_id=? AND teacher_id=?',[req.school.id,teacher]);
 for(const row of current)if(!subjects.includes(Number(row.subject_id)))await c.query('DELETE FROM teacher_subjects WHERE school_id=? AND teacher_id=? AND subject_id=?',[req.school.id,teacher,row.subject_id]);
 for(const subject of subjects)if(!current.some(r=>Number(r.subject_id)===subject))await c.query('INSERT INTO teacher_subjects VALUES (?,?,?)',[req.school.id,teacher,subject]);await audit(c,req,'update','teacher_subjects',teacher);
 });res.json({ok:true});
});
dataRoutes.put('/classrooms/:id/slots',async(req,res)=>{
 admin(req);const room=id(req.params.id),term=id(req.body.term_id);
 await transaction(async c=>{
 await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,term]);
 const [[r]]=await c.query('SELECT c.id,c.grade_level_id FROM classrooms c JOIN terms t ON t.school_id=c.school_id AND t.academic_year_id=c.academic_year_id WHERE c.school_id=? AND c.id=? AND t.id=?',[req.school.id,room,term]);if(!r)fail(400,'ห้องและภาคเรียนต้องอยู่ในปีการศึกษาเดียวกัน');
 await ensureRoomsOpen(c,req.school.id,term,[room]);
 const wanted=(req.body.slots||[]).map(id);const [current]=await c.query('SELECT slot_id FROM classroom_slots WHERE school_id=? AND term_id=? AND classroom_id=?',[req.school.id,term,room]);
 for(const row of current)if(!wanted.includes(Number(row.slot_id)))await c.query('DELETE FROM classroom_slots WHERE school_id=? AND term_id=? AND classroom_id=? AND slot_id=?',[req.school.id,term,room,row.slot_id]);
 for(const slot of wanted)if(!current.some(r=>Number(r.slot_id)===slot))await c.query('INSERT INTO classroom_slots VALUES (?,?,?,?)',[req.school.id,term,room,slot]);
 await audit(c,req,'update','classroom_slots',room);
 });res.json({ok:true});
});
export async function canCoordinate(req,term,rooms,c=pool){
 staffAccess(req);if(req.user.is_super_admin||req.member?.role==='school_admin')return;
 if(!req.member?.staff_id)fail(403,'คุณยังไม่ได้รับสิทธิ์จัดตาราง');
 const [allowed]=await c.query('SELECT c.id FROM classrooms c JOIN grade_coordinators g ON g.school_id=c.school_id AND g.grade_level_id=c.grade_level_id WHERE c.school_id=? AND g.term_id=? AND g.staff_id=?',[req.school.id,term,req.member.staff_id]);
 if(rooms.some(r=>!allowed.some(a=>Number(a.id)===Number(r))))fail(403,'คุณไม่มีสิทธิ์จัดตารางของชั้นนี้');
}
dataRoutes.post('/requirements',async(req,res)=>{
 const term=id(req.body.term_id),room=id(req.body.classroom_id);
 await canCoordinate(req,term,[room]);
 const requirement=await transaction(async c=>{
 await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,term]);
 const [[r]]=await c.query('SELECT c.id,c.grade_level_id FROM classrooms c JOIN terms t ON t.school_id=c.school_id AND t.academic_year_id=c.academic_year_id WHERE c.school_id=? AND c.id=? AND t.id=?',[req.school.id,room,term]);if(!r)fail(400,'ห้องและภาคเรียนคนละปีการศึกษา');
 await ensureRoomsOpen(c,req.school.id,term,[room]);
 await validateSubjectGrade(c,req.school.id,id(req.body.subject_id),r.grade_level_id);
 const [[teacher]]=await c.query('SELECT id FROM staff WHERE school_id=? AND id=? AND is_teacher=TRUE AND active=TRUE',[req.school.id,id(req.body.teacher_id)]);if(!teacher)fail(400,'ผู้สอนต้องเป็นครูที่เปิดใช้งาน');
 const values=curriculumItems([{subject_id:req.body.subject_id,periods_per_week:req.body.periods_per_week,daily_limit:req.body.daily_limit||1}])[0];
 const [duplicate]=await c.query('SELECT id FROM teaching_requirements WHERE school_id=? AND term_id=? AND classroom_id=? AND subject_id=? AND teacher_id=?',[req.school.id,term,room,values.subject_id,teacher.id]);if(duplicate.length)fail(400,'ครูคนนี้มีวิชานี้ในห้องแล้ว กรุณาแก้จำนวนคาบในรายการเดิม');
 const [result]=await c.query('INSERT INTO teaching_requirements(school_id,term_id,classroom_id,subject_id,teacher_id,periods_per_week,daily_limit) VALUES (?,?,?,?,?,?,?)',[req.school.id,term,room,values.subject_id,teacher.id,values.periods_per_week,values.daily_limit]);
 await audit(c,req,'create','teaching_requirements',result.insertId);return result.insertId;
 });res.status(201).json({id:requirement});
});
dataRoutes.delete('/requirements/:id',async(req,res)=>{
 const [[r]]=await pool.query('SELECT * FROM teaching_requirements WHERE school_id=? AND id=?',[req.school.id,id(req.params.id)]);if(!r)fail(404,'ไม่พบวิชา');await canCoordinate(req,r.term_id,[r.classroom_id]);
 await transaction(async c=>{await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,r.term_id]);await ensureRoomsOpen(c,req.school.id,r.term_id,[r.classroom_id]);await c.query('DELETE FROM teaching_requirements WHERE school_id=? AND id=?',[req.school.id,r.id]);await audit(c,req,'delete','teaching_requirements',r.id);});res.json({ok:true});
});
dataRoutes.put('/coordinator',async(req,res)=>{
 admin(req);await pool.query('INSERT INTO grade_coordinators VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id)',[req.school.id,id(req.body.term_id),id(req.body.grade_level_id),id(req.body.staff_id)]);res.json({ok:true});
});
dataRoutes.put('/unavailable',async(req,res)=>{
 const teacher=id(req.body.teacher_id),term=id(req.body.term_id);staffAccess(req);
 if(!req.user.is_super_admin&&req.member?.role!=='school_admin'&&Number(req.member?.staff_id)!==teacher)fail(403,'แก้เวลาว่างได้เฉพาะตนเอง');
 await transaction(async c=>{
 await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,term]);
 const slots=(req.body.slots||[]).map(id);
 if(slots.length){const [entries]=await c.query("SELECT e.slot_id FROM timetable_entries e JOIN timetable_versions v ON v.id=e.version_id AND v.school_id=e.school_id WHERE e.school_id=? AND e.teacher_id=? AND e.term_id=? AND e.slot_id IN (?) AND EXISTS(SELECT 1 FROM term_timetables current WHERE current.school_id=v.school_id AND current.version_id=v.id)",[req.school.id,teacher,term,slots]);if(entries.length)fail(400,'ครูมีคาบสอนในเวลาที่เลือก กรุณาปรับตารางก่อน');}
 await c.query('DELETE FROM teacher_unavailability WHERE school_id=? AND term_id=? AND teacher_id=?',[req.school.id,term,teacher]);
 for(const slot of slots)await c.query('INSERT INTO teacher_unavailability VALUES (?,?,?,?,?)',[req.school.id,term,teacher,slot,'กำหนดโดยผู้ใช้']);await audit(c,req,'update','teacher_unavailability',teacher);
 });res.json({ok:true});
});
dataRoutes.get('/accounts',async(req,res)=>{
 staffAccess(req);const [rows]=await pool.query('SELECT m.id,m.role,m.active,m.academic_year_id,u.username,u.display_name,s.id AS staff_id FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN staff s ON s.school_id=m.school_id AND s.membership_id=m.id WHERE m.school_id=? ORDER BY m.id',[req.school.id]);res.json(rows);
});
dataRoutes.post('/accounts',async(req,res)=>{
 const role=req.body.role;const isAdmin=req.user.is_super_admin||req.member?.role==='school_admin';
 if(!['school_admin','staff','student','guardian'].includes(role))fail(400,'ประเภทบัญชีไม่ถูกต้อง');
 if(role==='school_admin'&&!req.user.is_super_admin)fail(403,'เจ้าของระบบเป็นผู้สร้างผู้ดูแลโรงเรียน');
 if(role==='staff'&&!isAdmin)fail(403,'เฉพาะผู้ดูแลโรงเรียน');
 const password=randomBytes(10).toString('hex');const passwordHash=await bcrypt.hash(password,12);
 const account=await transaction(async c=>{
 let enrollment;
 if(['student','guardian'].includes(role)){
  const [[e]]=await c.query('SELECT e.*,c.homeroom_teacher_id FROM enrollments e JOIN classrooms c ON c.school_id=e.school_id AND c.id=e.classroom_id WHERE e.school_id=? AND e.student_id=? AND e.academic_year_id=?',[req.school.id,id(req.body.student_id),id(req.body.academic_year_id)]);
  if(!e)fail(400,'กรุณาลงทะเบียนนักเรียนเข้าห้องก่อน');enrollment=e;
  if(!isAdmin&&Number(e.homeroom_teacher_id)!==Number(req.member?.staff_id))fail(403,'เฉพาะครูประจำชั้นของนักเรียน');
 }
 const [user]=await c.query('INSERT INTO users(username,password_hash,display_name) VALUES (?,?,?)',[text(req.body.username,100),passwordHash,text(req.body.display_name)]);
 const [member]=await c.query('INSERT INTO memberships(school_id,user_id,role,academic_year_id) VALUES (?,?,?,?)',[req.school.id,user.insertId,role,enrollment?.academic_year_id||null]);
 if(role==='staff'){
  const [r]=await c.query('UPDATE staff SET membership_id=? WHERE school_id=? AND id=? AND membership_id IS NULL',[member.insertId,req.school.id,id(req.body.staff_id)]);if(!r.affectedRows)fail(400,'บุคลากรมีบัญชีแล้วหรือไม่พบข้อมูล');
 }
 if(role==='student')await c.query('INSERT INTO student_accounts VALUES (?,?,?)',[req.school.id,member.insertId,enrollment.student_id]);
 if(role==='guardian')await c.query('INSERT INTO guardian_students VALUES (?,?,?,?)',[req.school.id,member.insertId,enrollment.student_id,text(req.body.relationship||'ผู้ปกครอง',100)]);
 await audit(c,req,'create','membership',member.insertId,{role});return member.insertId;
 });res.status(201).json({id:account,password});
});
dataRoutes.put('/accounts/:id',async(req,res)=>{
 admin(req);await transaction(async c=>{const [[m]]=await c.query('SELECT * FROM memberships WHERE school_id=? AND id=?',[req.school.id,id(req.params.id)]);if(!m)fail(404,'ไม่พบบัญชี');if(m.role==='school_admin'&&!req.user.is_super_admin)fail(403,'เฉพาะเจ้าของระบบจัดการบัญชีผู้ดูแลโรงเรียน');if(Number(m.user_id)===Number(req.user.id))fail(400,'ไม่สามารถปิดบัญชีที่กำลังใช้งาน');await c.query('UPDATE memberships SET active=? WHERE id=?',[req.body.active?1:0,m.id]);await c.query('DELETE FROM sessions WHERE user_id=?',[m.user_id]);await audit(c,req,'update','membership',m.id);});res.json({ok:true});
});
dataRoutes.put('/enrollments',async(req,res)=>{
 admin(req);await transaction(async c=>{const school=req.school.id,year=id(req.body.academic_year_id),room=id(req.body.classroom_id);const [[r]]=await c.query('SELECT id FROM classrooms WHERE school_id=? AND id=? AND academic_year_id=?',[school,room,year]);if(!r)fail(400,'ห้องและปีการศึกษาไม่ตรงกัน');await c.query('INSERT INTO enrollments VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE classroom_id=VALUES(classroom_id)',[school,year,id(req.body.student_id),room]);});res.json({ok:true});
});
dataRoutes.post('/rollover',async(req,res)=>{
 admin(req);const year=id(req.body.academic_year_id);
 await transaction(async c=>{
 const [[y]]=await c.query('SELECT * FROM academic_years WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,year]);if(!y)fail(404,'ไม่พบปีการศึกษา');
 await c.query("DELETE s FROM sessions s JOIN memberships m ON m.user_id=s.user_id WHERE m.school_id=? AND m.academic_year_id=? AND m.role IN ('student','guardian')",[req.school.id,year]);
 await c.query("UPDATE memberships SET active=FALSE WHERE school_id=? AND academic_year_id=? AND role IN ('student','guardian')",[req.school.id,year]);
 await c.query("UPDATE academic_years SET status='archived' WHERE school_id=? AND id=?",[req.school.id,year]);await audit(c,req,'archive','academic_year',year);
 });res.json({ok:true});
});

dataRoutes.post('/week',async(req,res)=>{
 admin(req);const term=id(req.body.term_id);
 const result=await transaction(async c=>{const result=await insertSlotBatch(c,req.school.id,term,req.body);await audit(c,req,'create','teaching_week',term,result);return result;});res.json(result);
});
dataRoutes.get('/portal',async(req,res)=>{
 if(!['student','guardian'].includes(req.member?.role))fail(403,'พื้นที่นี้สำหรับนักเรียนและผู้ปกครอง');
 const mapping=req.member.role==='student'?'student_accounts':'guardian_students';
 const [students]=await pool.query(`SELECT s.id,s.display_name,s.code,c.id AS classroom_id,c.name AS classroom_name FROM ${mapping} a JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id JOIN enrollments e ON e.school_id=s.school_id AND e.student_id=s.id AND e.academic_year_id=? JOIN classrooms c ON c.school_id=e.school_id AND c.id=e.classroom_id WHERE a.school_id=? AND a.membership_id=?`,[req.member.academic_year_id,req.school.id,req.member.id]);
 const schedules=[];
 for(const student of students){
 const [entries]=await pool.query("SELECT e.*,sl.weekday,sl.period_number,sl.starts_at,sl.ends_at,sub.name AS subject_name,st.display_name AS teacher_name FROM timetable_entries e JOIN timetable_versions v ON v.id=e.version_id AND v.school_id=e.school_id JOIN term_timetables current ON current.school_id=v.school_id AND current.version_id=v.id JOIN classrooms cr ON cr.school_id=e.school_id AND cr.id=e.classroom_id JOIN timetable_grade_completion done ON done.school_id=v.school_id AND done.term_id=v.term_id AND done.grade_level_id=cr.grade_level_id JOIN terms t ON t.id=v.term_id AND t.school_id=v.school_id JOIN teaching_slots sl ON sl.id=e.slot_id AND sl.school_id=e.school_id JOIN teaching_requirements r ON r.id=e.requirement_id AND r.school_id=e.school_id JOIN subjects sub ON sub.id=r.subject_id AND sub.school_id=r.school_id JOIN staff st ON st.id=e.teacher_id AND st.school_id=e.school_id WHERE e.school_id=? AND e.classroom_id=? AND t.academic_year_id=? ORDER BY sl.weekday,sl.period_number",[req.school.id,student.classroom_id,req.member.academic_year_id]);schedules.push({student,entries});
 }res.json(schedules);
});
dataRoutes.post('/accounts/:id/reset',async(req,res)=>{
 admin(req);const password=randomBytes(10).toString('hex');const passwordHash=await bcrypt.hash(password,12);
 const username=await transaction(async c=>{const [[m]]=await c.query('SELECT m.*,u.username FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=? AND m.id=? FOR UPDATE',[req.school.id,id(req.params.id)]);if(!m)fail(404,'ไม่พบบัญชี');if(m.role==='school_admin'&&!req.user.is_super_admin)fail(403,'เฉพาะเจ้าของระบบรีเซ็ตรหัสผู้ดูแลโรงเรียน');if(Number(m.user_id)===Number(req.user.id))fail(400,'เปลี่ยนรหัสบัญชีตนเองได้ที่บัญชีของฉัน');await c.query('UPDATE users SET password_hash=?,must_change_password=TRUE WHERE id=?',[passwordHash,m.user_id]);await c.query('DELETE FROM sessions WHERE user_id=?',[m.user_id]);await audit(c,req,'reset_password','membership',m.id);return m.username;});res.json({username,password});
});

dataRoutes.put('/grade-curriculum',async(req,res)=>{
 admin(req);const term=id(req.body.term_id),grade=id(req.body.grade_level_id),items=curriculumItems(req.body.items);
 await transaction(async c=>{
 const [[t]]=await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,term]);if(!t)fail(400,'ไม่พบภาคเรียน');
 const [[g]]=await c.query('SELECT id FROM grade_levels WHERE school_id=? AND id=?',[req.school.id,grade]);if(!g)fail(400,'ไม่พบระดับชั้น');
 for(const item of items)await validateSubjectGrade(c,req.school.id,item.subject_id,grade);
 await c.query('DELETE FROM grade_curriculum WHERE school_id=? AND term_id=? AND grade_level_id=?',[req.school.id,term,grade]);
 for(const item of items)await c.query('INSERT INTO grade_curriculum VALUES (?,?,?,?,?,?)',[req.school.id,term,grade,item.subject_id,item.periods_per_week,item.daily_limit]);
 await audit(c,req,'update','grade_curriculum',grade,{term});
 });res.json({ok:true});
});
dataRoutes.post('/grade-curriculum/apply',async(req,res)=>{
 admin(req);const term=id(req.body.term_id),grade=id(req.body.grade_level_id);
 const result=await transaction(async c=>{const [[t]]=await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,term]);if(!t)fail(400,'ไม่พบภาคเรียน');return applyCurriculum(c,req,term,grade,req.body.assignments);});res.json(result);
});

dataRoutes.put('/requirements/:id',async(req,res)=>{
 const recordId=id(req.params.id);const [[record]]=await pool.query('SELECT * FROM teaching_requirements WHERE school_id=? AND id=?',[req.school.id,recordId]);if(!record)fail(404,'ไม่พบวิชา');
 await canCoordinate(req,record.term_id,[record.classroom_id]);
 const values=curriculumItems([{subject_id:record.subject_id,periods_per_week:req.body.periods_per_week,daily_limit:req.body.daily_limit}])[0];
 await transaction(async c=>{
 await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[req.school.id,record.term_id]);
 await ensureRoomsOpen(c,req.school.id,record.term_id,[record.classroom_id]);
 const [entries]=await c.query('SELECT id FROM timetable_entries WHERE school_id=? AND requirement_id=? LIMIT 1',[req.school.id,recordId]);if(entries.length)fail(400,'วิชานี้มีคาบในตารางแล้ว ต้องรักษาข้อมูลตารางและประวัติเดิม');
 const teacher=id(req.body.teacher_id);const [[allowed]]=await c.query('SELECT s.id FROM staff s JOIN teacher_subjects ts ON ts.school_id=s.school_id AND ts.teacher_id=s.id WHERE s.school_id=? AND s.id=? AND s.active=TRUE AND s.is_teacher=TRUE AND ts.subject_id=?',[req.school.id,teacher,record.subject_id]);if(!allowed)fail(400,'ครูไม่ได้รับมอบหมายให้สอนวิชานี้');
 await c.query('UPDATE teaching_requirements SET teacher_id=?,periods_per_week=?,daily_limit=? WHERE school_id=? AND id=?',[teacher,values.periods_per_week,values.daily_limit,req.school.id,recordId]);await audit(c,req,'update','teaching_requirements',recordId);
 });res.json({ok:true});
});
