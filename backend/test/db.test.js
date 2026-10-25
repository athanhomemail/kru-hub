import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.js';

test('school boundaries, teacher collisions and manual locks', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  const c = await pool.getConnection();
  await c.beginTransaction();
  const tag = randomUUID();
  const insert = async (sql, values) => (await c.query(sql, values))[0].insertId;
  try {
    const a = await insert('INSERT INTO schools (code,name) VALUES (?,?)', [`a-${tag}`, 'โรงเรียนทดสอบ ก']);
    const b = await insert('INSERT INTO schools (code,name) VALUES (?,?)', [`b-${tag}`, 'โรงเรียนทดสอบ ข']);
    // Optional codes must support multiple unnamed codes, while explicit codes stay unique.
    const withoutCode = await insert('INSERT INTO staff (school_id,display_name) VALUES (?,?)',[a,'ครูชื่อซ้ำ']);
    const alsoWithoutCode = await insert('INSERT INTO staff (school_id,code,display_name) VALUES (?,NULL,?)',[a,'ครูชื่อซ้ำ']);
    assert.notEqual(withoutCode,alsoWithoutCode);
    await c.query('UPDATE staff SET code=? WHERE id=?',['STAFF-1',withoutCode]);
    await assert.rejects(c.query('UPDATE staff SET code=? WHERE id=?',['STAFF-1',alsoWithoutCode]),{code:'ER_DUP_ENTRY'});
    await c.query('UPDATE staff SET code=NULL WHERE id=?',[withoutCode]);
    const dept = await insert('INSERT INTO departments (school_id,name) VALUES (?,?)', [b, 'วิทยาศาสตร์']);
    await assert.rejects(c.query('INSERT INTO staff (school_id,department_id,code,display_name) VALUES (?,?,?,?)', [a,dept,tag,'ครู']), { code: 'ER_NO_REFERENCED_ROW_2' });
    const year = await insert("INSERT INTO academic_years (school_id,buddhist_year,starts_on,ends_on) VALUES (?,2569,'2026-05-01','2027-04-30')", [a]);
    const term = await insert("INSERT INTO terms (school_id,academic_year_id,term_number,starts_on,ends_on) VALUES (?,?,1,'2026-05-01','2026-10-31')", [a,year]);
    const grade = await insert("INSERT INTO grade_levels (school_id,name) VALUES (?,'ป.5')", [a]);
    const teacher = await insert("INSERT INTO staff (school_id,code,display_name) VALUES (?,?,'ครูทดสอบ')", [a,tag]);
    const subject = await insert("INSERT INTO subjects (school_id,code,name) VALUES (?,?,'คณิตศาสตร์')", [a,tag]);
    await c.query('INSERT INTO teacher_subjects VALUES (?,?,?)',[a,teacher,subject]);
    const user = await insert("INSERT INTO users (username,password_hash,display_name) VALUES (?,'test-only','ผู้จัด')",[tag]);
    const version = await insert('INSERT INTO timetable_versions (school_id,term_id,created_by) VALUES (?,?,?)',[a,term,user]);
    const slot = await insert("INSERT INTO teaching_slots (school_id,term_id,weekday,period_number,starts_at,ends_at) VALUES (?,?,1,1,'08:30','09:30')", [a,term]);
    const rooms = [];
    for (let i=1;i<=2;i++) {
      const room = await insert('INSERT INTO classrooms (school_id,academic_year_id,grade_level_id,name) VALUES (?,?,?,?)',[a,year,grade,`5/${i}`]);
      await c.query('INSERT INTO classroom_slots VALUES (?,?,?,?)',[a,term,room,slot]);
      const req = await insert('INSERT INTO teaching_requirements (school_id,term_id,classroom_id,subject_id,teacher_id,periods_per_week) VALUES (?,?,?,?,?,1)',[a,term,room,subject,teacher]);
      rooms.push({room,req});
    }
    const entry = (i, source, locked) => c.query('INSERT INTO timetable_entries (school_id,term_id,version_id,classroom_id,requirement_id,teacher_id,slot_id,source,locked) VALUES (?,?,?,?,?,?,?,?,?)',[a,term,version,rooms[i].room,rooms[i].req,teacher,slot,source,locked]);
    await assert.rejects(entry(0,'manual',false), {code:'ER_CHECK_CONSTRAINT_VIOLATED'});
    await entry(0,'manual',true);
    await assert.rejects(entry(1,'auto',false), {code:'ER_DUP_ENTRY'});
    const [[row]] = await c.query('SELECT name FROM schools WHERE id=?',[a]);
    assert.equal(row.name,'โรงเรียนทดสอบ ก');
  } finally { await c.rollback(); c.release(); }
});
test.after(async () => { await pool.end(); });
