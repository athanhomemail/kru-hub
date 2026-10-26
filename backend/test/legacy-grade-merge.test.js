import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.js';
import {inspectMerge} from '../scripts/merge-legacy-grades.mjs';

test('deployment preflight validates explicit grade sources, teacher conflicts and completed quotas without writing lessons',{skip:process.env.RUN_DB_TESTS!=='1'},async()=>{
 const c=await pool.getConnection();await c.beginTransaction();
 const insert=async(sql,args)=>(await c.query(sql,args))[0].insertId;
 try{
  const school=await insert('INSERT INTO schools(code,name) VALUES (?,?)',[randomUUID(),'ทดสอบย้ายรายชั้น']);
  const user=await insert("INSERT INTO users(username,password_hash,display_name) VALUES (?,'test-only','ผู้จัดทดสอบ')",[randomUUID()]);
  const year=await insert("INSERT INTO academic_years(school_id,buddhist_year,starts_on,ends_on) VALUES (?,2569,'2026-05-01','2027-04-30')",[school]);
  const term=await insert("INSERT INTO terms(school_id,academic_year_id,term_number,starts_on,ends_on) VALUES (?,?,1,'2026-05-01','2026-10-31')",[school,year]);
  const grades=[],rooms=[],teachers=[],subjects=[],slots=[];
  for(let i=0;i<2;i++){
   grades.push(await insert('INSERT INTO grade_levels(school_id,name) VALUES (?,?)',[school,`ป.${5-i}`]));
   rooms.push(await insert('INSERT INTO classrooms(school_id,academic_year_id,grade_level_id,name) VALUES (?,?,?,?)',[school,year,grades[i],`ป.${5-i}/1`]));
   teachers.push(await insert('INSERT INTO staff(school_id,display_name) VALUES (?,?)',[school,`ครู ${i}`]));
   subjects.push(await insert('INSERT INTO subjects(school_id,code,name) VALUES (?,?,?)',[school,`S${i}`,`วิชา ${i}`]));
   await c.query('INSERT INTO teacher_subjects VALUES (?,?,?)',[school,teachers[i],subjects[i]]);
   slots.push(await insert('INSERT INTO teaching_slots(school_id,term_id,weekday,period_number,starts_at,ends_at) VALUES (?,?,1,?,?,?)',[school,term,i+1,`${8+i}:30`,`${9+i}:30`]));
  }
  await c.query('INSERT INTO classroom_slots VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?)',[school,term,rooms[0],slots[0],school,term,rooms[1],slots[0],school,term,rooms[1],slots[1]]);
  const reqs=[];for(const [room,teacher,subject] of [[rooms[0],teachers[0],subjects[0]],[rooms[1],teachers[0],subjects[0]],[rooms[1],teachers[1],subjects[1]]])reqs.push(await insert('INSERT INTO teaching_requirements(school_id,term_id,classroom_id,teacher_id,subject_id,periods_per_week) VALUES (?,?,?,?,?,1)',[school,term,room,teacher,subject]));
  const a=await insert('INSERT INTO timetable_versions(school_id,term_id,created_by) VALUES (?,?,?)',[school,term,user]),b=await insert('INSERT INTO timetable_versions(school_id,term_id,created_by) VALUES (?,?,?)',[school,term,user]);
  const entries=[];for(const [version,room,req,teacher,slot] of [[a,rooms[0],reqs[0],teachers[0],slots[0]],[b,rooms[1],reqs[1],teachers[0],slots[1]],[b,rooms[1],reqs[2],teachers[1],slots[0]]])entries.push(await insert("INSERT INTO timetable_entries(school_id,term_id,version_id,classroom_id,requirement_id,teacher_id,slot_id,source,locked) VALUES (?,?,?,?,?,?,?,'auto',FALSE)",[school,term,version,room,req,teacher,slot]));
  await c.query('INSERT INTO term_timetables VALUES (?,?,?)',[school,term,b]);
  const plan={school_id:school,term_id:term,require_no_published:true,grades:[{grade_level_id:grades[0],source_version_id:a,expected_lessons:1,completed:true},{grade_level_id:grades[1],source_version_id:b,expected_lessons:2,completed:false}]};
  const [before]=await c.query('SELECT * FROM timetable_entries WHERE school_id=? ORDER BY id',[school]);
  const result=await inspectMerge(c,plan);assert.equal(result.selected.length,3);assert.equal(result.summary[0].status,'completed');assert.equal(result.summary[1].status,'in_progress');assert.equal(result.alreadyApplied,false);
  const wrongCount=structuredClone(plan);wrongCount.grades[1].expected_lessons=3;await assert.rejects(inspectMerge(c,wrongCount),/expected 3/);
  const wrongVersion=structuredClone(plan);wrongVersion.grades[0].source_version_id=999999999;await assert.rejects(inspectMerge(c,wrongVersion),/Source timetable not found/);
  await c.query('SAVEPOINT valid_sources');
  await c.query('DELETE FROM timetable_entries WHERE id=?',[entries[2]]);await c.query('UPDATE timetable_entries SET slot_id=? WHERE id=?',[slots[0],entries[1]]);
  const conflict=structuredClone(plan);conflict.grades[1].expected_lessons=1;await assert.rejects(inspectMerge(c,conflict),/Cannot combine.*ครูมีคาบ/);await c.query('ROLLBACK TO SAVEPOINT valid_sources');
  await c.query('UPDATE teaching_requirements SET periods_per_week=2 WHERE id=?',[reqs[0]]);await assert.rejects(inspectMerge(c,plan),/กำหนดวิชา|คาบมากกว่า/);await c.query('ROLLBACK TO SAVEPOINT valid_sources');
  await c.query("UPDATE timetable_versions SET status='published' WHERE id=?",[a]);await assert.rejects(inspectMerge(c,plan),/published schedule now exists/);await c.query('ROLLBACK TO SAVEPOINT valid_sources');
  const [after]=await c.query('SELECT * FROM timetable_entries WHERE school_id=? ORDER BY id',[school]);assert.deepEqual(after,before);
 }finally{await c.rollback();c.release();}
});
test.after(async()=>{await pool.end();});
