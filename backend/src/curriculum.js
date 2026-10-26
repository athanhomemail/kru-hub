import {ensureRoomsOpen} from './grade-workflow.js';
import {fail,id,audit} from './common.js';
export async function saveSubjectGrades(c,school,subject,values){
 if(!Array.isArray(values))fail(400,'ระดับชั้นต้องเป็นรายการ');
 const grades=[...new Set(values.map(id))];
 for(const grade of grades){const [[g]]=await c.query('SELECT id FROM grade_levels WHERE school_id=? AND id=?',[school,grade]);if(!g)fail(400,'ไม่พบระดับชั้นในโรงเรียน');}
 await c.query('DELETE FROM subject_grades WHERE school_id=? AND subject_id=?',[school,subject]);
 for(const grade of grades)await c.query('INSERT INTO subject_grades VALUES (?,?,?)',[school,subject,grade]);
}
export async function validateSubjectGrade(c,school,subject,grade){
 const [[s]]=await c.query('SELECT id FROM subjects WHERE school_id=? AND id=?',[school,subject]);if(!s)fail(400,'ไม่พบรายวิชาในโรงเรียน');
 const [grades]=await c.query('SELECT grade_level_id FROM subject_grades WHERE school_id=? AND subject_id=?',[school,subject]);
 if(grades.length&&!grades.some(g=>Number(g.grade_level_id)===Number(grade)))fail(400,'รายวิชาไม่ได้เปิดสำหรับระดับชั้นนี้');
}
export function curriculumItems(items){
 if(!Array.isArray(items)||items.length>100)fail(400,'ชุดวิชาไม่ถูกต้อง');
 const result=items.map(r=>({subject_id:id(r.subject_id),periods_per_week:id(r.periods_per_week),daily_limit:id(r.daily_limit)}));
 if(new Set(result.map(r=>r.subject_id)).size!==result.length)fail(400,'มีรายวิชาซ้ำในชุด');
 if(result.some(r=>r.periods_per_week>60||r.daily_limit>12))fail(400,'จำนวนคาบต้องไม่เกิน 60 ต่อสัปดาห์ และ 12 ต่อวัน');
 return result;
}
export async function applyCurriculum(c,req,term,grade,assignments){
 if(!Array.isArray(assignments)||!assignments.length||assignments.length>2000)fail(400,'กรุณาเลือกห้องและครูผู้สอน');
 const [items]=await c.query('SELECT * FROM grade_curriculum WHERE school_id=? AND term_id=? AND grade_level_id=?',[req.school.id,term,grade]);
 if(!items.length)fail(400,'ยังไม่มีชุดวิชาประจำชั้น');
 const normalized=assignments.map(a=>({room:id(a.classroom_id),subject:id(a.subject_id),teacher:id(a.teacher_id)}));
 if(new Set(normalized.map(a=>`${a.room}:${a.subject}`)).size!==normalized.length)fail(400,'รายการห้องและวิชาซ้ำ');
 const rooms=[...new Set(normalized.map(a=>a.room))];let added=0,skipped=0;
 await ensureRoomsOpen(c,req.school.id,term,rooms);
 for(const room of rooms){
  const [[r]]=await c.query('SELECT c.id FROM classrooms c JOIN terms t ON t.school_id=c.school_id AND t.academic_year_id=c.academic_year_id WHERE c.school_id=? AND c.id=? AND c.grade_level_id=? AND t.id=?',[req.school.id,room,grade,term]);if(!r)fail(400,'ห้องและชั้นปีไม่ตรงกับภาคเรียน');
  for(const item of items){
   const [[existing]]=await c.query('SELECT id FROM teaching_requirements WHERE school_id=? AND term_id=? AND classroom_id=? AND subject_id=?',[req.school.id,term,room,item.subject_id]);
   if(existing){skipped++;continue;}
   const a=normalized.find(a=>a.room===room&&a.subject===Number(item.subject_id));if(!a)fail(400,'กรุณากำหนดครูให้ครบทุกวิชาของห้องที่เลือก');
   await validateSubjectGrade(c,req.school.id,item.subject_id,grade);
   const [[teacher]]=await c.query('SELECT s.id FROM staff s JOIN teacher_subjects ts ON ts.school_id=s.school_id AND ts.teacher_id=s.id WHERE s.school_id=? AND s.id=? AND s.active=TRUE AND s.is_teacher=TRUE AND ts.subject_id=?',[req.school.id,a.teacher,item.subject_id]);if(!teacher)fail(400,'ครูไม่ได้รับมอบหมายให้สอนวิชานี้');
   await c.query('INSERT INTO teaching_requirements (school_id,term_id,classroom_id,subject_id,teacher_id,periods_per_week,daily_limit) VALUES (?,?,?,?,?,?,?)',[req.school.id,term,room,item.subject_id,a.teacher,item.periods_per_week,item.daily_limit]);added++;
  }
  const [[count]]=await c.query('SELECT COUNT(*) AS n FROM classroom_slots WHERE school_id=? AND term_id=? AND classroom_id=?',[req.school.id,term,room]);
  const [[sum]]=await c.query('SELECT SUM(periods_per_week) AS n FROM teaching_requirements WHERE school_id=? AND term_id=? AND classroom_id=?',[req.school.id,term,room]);
  if(Number(sum.n)>Number(count.n))fail(400,'จำนวนคาบรวมเกินคาบที่เปิดสอนของห้อง กรุณาปรับชุดวิชาหรือคาบของห้อง');
 }
 if(normalized.some(a=>!items.some(i=>Number(i.subject_id)===a.subject)))fail(400,'พบวิชาที่ไม่อยู่ในชุด');
 await audit(c,req,'apply','grade_curriculum',grade,{term,added,skipped});return {added,skipped};
}
