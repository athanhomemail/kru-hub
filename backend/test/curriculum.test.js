import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.js';
import {saveSubjectGrades,validateSubjectGrade,curriculumItems,applyCurriculum} from '../src/curriculum.js';
test('curriculum rejects duplicate subjects and invalid limits',()=>{
 assert.throws(()=>curriculumItems([{subject_id:1,periods_per_week:2,daily_limit:1},{subject_id:1,periods_per_week:1,daily_limit:1}]),{status:400});
 assert.throws(()=>curriculumItems([{subject_id:1,periods_per_week:61,daily_limit:1}]),{status:400});
});
test('grade eligibility, multi-room apply, existing preservation and atomic failure',{skip:process.env.RUN_DB_TESTS!=='1'},async()=>{
 const c=await pool.getConnection();await c.beginTransaction();const tag=randomUUID();
 const insert=async(sql,args)=>(await c.query(sql,args))[0].insertId;
 try{
 const school=await insert('INSERT INTO schools(code,name) VALUES (?,?)',[tag,'ทดสอบหลักสูตร']);
 const user=await insert('INSERT INTO users(username,password_hash,display_name) VALUES (?, ?, ?)',[tag,'test-only','ทดสอบ']);
 const grade=await insert('INSERT INTO grade_levels(school_id,name) VALUES (?,?)',[school,'ป.5']);
 const otherGrade=await insert('INSERT INTO grade_levels(school_id,name) VALUES (?,?)',[school,'ป.6']);
 const year=await insert("INSERT INTO academic_years(school_id,buddhist_year,starts_on,ends_on) VALUES (?,2569,'2026-05-01','2027-04-30')",[school]);
 const term=await insert("INSERT INTO terms(school_id,academic_year_id,term_number,starts_on,ends_on) VALUES (?,?,1,'2026-05-01','2026-10-31')",[school,year]);
 const subject=await insert('INSERT INTO subjects(school_id,code,name) VALUES (?,?,?)',[school,'M','คณิต']);
 const teacher=await insert('INSERT INTO staff(school_id,display_name) VALUES (?,?)',[school,'ครูทดสอบ']);
 await c.query('INSERT INTO teacher_subjects VALUES (?,?,?)',[school,teacher,subject]);
 await validateSubjectGrade(c,school,subject,otherGrade); // Legacy subjects stay usable.
 await saveSubjectGrades(c,school,subject,[grade]);
 await assert.rejects(validateSubjectGrade(c,school,subject,otherGrade),{status:400});
 await saveSubjectGrades(c,school,subject,[grade,otherGrade]);
 await validateSubjectGrade(c,school,subject,otherGrade);
 const rooms=[];
 const slot=await insert("INSERT INTO teaching_slots(school_id,term_id,weekday,period_number,starts_at,ends_at) VALUES (?,?,1,1,'08:30','09:20')",[school,term]);
 for(const name of ['5/1','5/2']){const room=await insert('INSERT INTO classrooms(school_id,academic_year_id,grade_level_id,name) VALUES (?,?,?,?)',[school,year,grade,name]);rooms.push(room);await c.query('INSERT INTO classroom_slots VALUES (?,?,?,?)',[school,term,room,slot]);}
 await c.query('INSERT INTO grade_curriculum VALUES (?,?,?,?,1,1)',[school,term,grade,subject]);
 const req={school:{id:school},user:{id:user}};
 const assignments=rooms.map(room=>({classroom_id:room,subject_id:subject,teacher_id:teacher}));
 await c.query('SAVEPOINT before_apply');
 await assert.rejects(applyCurriculum(c,req,term,grade,[assignments[0],{...assignments[1],teacher_id:99999999}]),{status:400});
 await c.query('ROLLBACK TO SAVEPOINT before_apply');
 const [[count]]=await c.query('SELECT COUNT(*) AS n FROM teaching_requirements WHERE school_id=?',[school]);assert.equal(count.n,0);
 assert.deepEqual(await applyCurriculum(c,req,term,grade,assignments),{added:2,skipped:0});
 assert.deepEqual(await applyCurriculum(c,req,term,grade,assignments),{added:0,skipped:2});
 await c.query('DELETE FROM teaching_requirements WHERE school_id=?',[school]);
 await c.query('UPDATE grade_curriculum SET periods_per_week=2 WHERE school_id=?',[school]);
 await assert.rejects(applyCurriculum(c,req,term,grade,assignments),{status:400});
 }finally{await c.rollback();c.release();}
});
test.after(async()=>{await pool.end();});
