import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pool} from '../src/db.js';

test('upgrade adopts approved published lessons without changing entries and preserves work made after upgrade',{skip:process.env.RUN_DB_TESTS!=='1'},async()=>{
 const c=await pool.getConnection();await c.beginTransaction();
 const insert=async(sql,args)=>(await c.query(sql,args))[0].insertId;
 try{
  const user=await insert("INSERT INTO users(username,password_hash,display_name) VALUES (?,'test-only','ผู้จัดทดสอบ')",[randomUUID()]);
  async function scenario({edited=false,published=true}={}){
   const school=await insert('INSERT INTO schools(code,name) VALUES (?,?)',[randomUUID(),'ทดสอบรักษาตารางเผยแพร่']);
   const year=await insert("INSERT INTO academic_years(school_id,buddhist_year,starts_on,ends_on) VALUES (?,2569,'2026-05-01','2027-04-30')",[school]);
   const term=await insert("INSERT INTO terms(school_id,academic_year_id,term_number,starts_on,ends_on) VALUES (?,?,1,'2026-05-01','2026-10-31')",[school,year]);
   const grade=await insert("INSERT INTO grade_levels(school_id,name) VALUES (?,'ป.5')",[school]);
   const room=await insert("INSERT INTO classrooms(school_id,academic_year_id,grade_level_id,name) VALUES (?,?,?,'ป.5/1')",[school,year,grade]);
   const slots=[],requirements=[],teachers=[];
   for(let p=1;p<=2;p++){
    const teacher=await insert('INSERT INTO staff(school_id,display_name) VALUES (?,?)',[school,`ครู ${p}`]);teachers.push(teacher);
    const subject=await insert('INSERT INTO subjects(school_id,code,name) VALUES (?,?,?)',[school,`S${p}`,`วิชา ${p}`]);await c.query('INSERT INTO teacher_subjects VALUES (?,?,?)',[school,teacher,subject]);
    const slot=await insert('INSERT INTO teaching_slots(school_id,term_id,weekday,period_number,starts_at,ends_at) VALUES (?,?,1,?,?,?)',[school,term,p,`${7+p}:30`,`${8+p}:30`]);slots.push(slot);await c.query('INSERT INTO classroom_slots VALUES (?,?,?,?)',[school,term,room,slot]);
    requirements.push(await insert('INSERT INTO teaching_requirements(school_id,term_id,classroom_id,teacher_id,subject_id,periods_per_week) VALUES (?,?,?,?,?,1)',[school,term,room,teacher,subject]));
   }
   const approved=await insert("INSERT INTO timetable_versions(school_id,term_id,created_by,status,published_at,revision) VALUES (?,?,?, ?,DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 DAY),4)",[school,term,user,published?'published':'archived']);
   const draft=await insert('INSERT INTO timetable_versions(school_id,term_id,created_by,revision) VALUES (?,?,?,2)',[school,term,user]);
   for(let i=0;i<2;i++){
    await c.query("INSERT INTO timetable_entries(school_id,term_id,version_id,classroom_id,teacher_id,requirement_id,slot_id,source,locked) VALUES (?,?,?,?,?,?,?,'manual',TRUE)",[school,term,approved,room,teachers[i],requirements[i],slots[i]]);
    await c.query("INSERT INTO timetable_entries(school_id,term_id,version_id,classroom_id,teacher_id,requirement_id,slot_id,source,locked) VALUES (?,?,?,?,?,?,?,'auto',FALSE)",[school,term,draft,room,teachers[i],requirements[i],slots[1-i]]);
   }
   // This represents migration 009 selecting a newer experimental draft.
   await c.query('INSERT INTO term_timetables VALUES (?,?,?)',[school,term,draft]);
   if(edited)await c.query("INSERT INTO audit_logs(school_id,actor_user_id,action,entity_type,entity_id) VALUES (?,?,'auto','timetable',?)",[school,user,draft]);
   return {school,term,grade,approved,draft};
  }
  const fresh=await scenario(),alreadyEdited=await scenario({edited:true}),noPublished=await scenario({published:false});
  const schools=[fresh.school,alreadyEdited.school,noPublished.school];
  const [before]=await c.query('SELECT * FROM timetable_entries WHERE school_id IN (?) ORDER BY id',[schools]);
  const [versionsBefore]=await c.query('SELECT * FROM timetable_versions WHERE school_id IN (?) ORDER BY id',[schools]);
  const sql=await readFile(new URL('../../schemas/010-preserve-published-timetable.sql',import.meta.url),'utf8');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean).slice(1))await c.query(statement);
  for(const [fixture,expected] of [[fresh,fresh.approved],[alreadyEdited,alreadyEdited.draft],[noPublished,noPublished.draft]]){
   const [[current]]=await c.query('SELECT version_id FROM term_timetables WHERE school_id=? AND term_id=?',[fixture.school,fixture.term]);assert.equal(current.version_id,expected);
  }
  const [done]=await c.query('SELECT grade_level_id FROM timetable_grade_completion WHERE school_id=? AND term_id=?',[fresh.school,fresh.term]);assert.deepEqual(done.map(d=>d.grade_level_id),[fresh.grade]);
  const [[kept]]=await c.query('SELECT adopted FROM timetable_published_imports WHERE school_id=? AND term_id=?',[alreadyEdited.school,alreadyEdited.term]);assert.equal(kept.adopted,0);
  const [after]=await c.query('SELECT * FROM timetable_entries WHERE school_id IN (?) ORDER BY id',[schools]);assert.deepEqual(after,before);
  const [versionsAfter]=await c.query('SELECT * FROM timetable_versions WHERE school_id IN (?) ORDER BY id',[schools]);assert.deepEqual(versionsAfter,versionsBefore);
 }finally{await c.rollback();c.release();}
});
test.after(async()=>{await pool.end();});
