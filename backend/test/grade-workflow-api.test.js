import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {pool} from '../src/db.js';

test('coordinators share one term timetable, finish grades independently and respect shared teachers',{skip:process.env.RUN_API_TESTS!=='1'},async()=>{
 const base=process.env.TEST_API_URL||'http://127.0.0.1:4001/api';
 const tag=randomUUID().slice(0,8),grades=[],rooms=[],teachers=[],users=[],subjects=[];let school,year,term,version,student;
 const insert=async(sql,args)=>(await pool.query(sql,args))[0].insertId;
 async function call(path,body,method='GET',cookie=''){
  const r=await fetch(base+path,{method,headers:{'X-KruHub':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(role,name,staffId){
  const user=await insert('INSERT INTO users(username,password_hash,display_name,must_change_password) VALUES (?,\'test-only\',?,FALSE)',[`${tag}-${name}`,name]);users.push(user);
  const member=await insert('INSERT INTO memberships(school_id,user_id,role,academic_year_id) VALUES (?,?,?,?)',[school,user,role,role==='student'?year:null]);
  if(staffId)await pool.query('UPDATE staff SET membership_id=? WHERE id=?',[member,staffId]);
  const token=randomUUID();await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[createHash('sha256').update(token).digest('hex'),user]);
  return {member,cookie:`kruhub_session=${token}`};
 }
 try{
  const login=await call('/auth/demo',{},'POST');const adminCookie=login.cookie;
  const me=await call('/auth/me',undefined,'GET',adminCookie);school=me.data.schools.find(s=>s.code==='kruhub-demo').id;const url=`/schools/${school}`;
  const [[next]]=await pool.query('SELECT MAX(buddhist_year)+1 AS n FROM academic_years WHERE school_id=?',[school]);
  year=await insert("INSERT INTO academic_years(school_id,buddhist_year,starts_on,ends_on) VALUES (?,?,'2026-05-01','2027-04-30')",[school,next.n]);
  term=await insert("INSERT INTO terms(school_id,academic_year_id,term_number,starts_on,ends_on) VALUES (?,?,1,'2026-05-01','2026-10-31')",[school,year]);
  for(const name of ['ป.5','ป.4']){const grade=await insert('INSERT INTO grade_levels(school_id,name,abbreviation) VALUES (?,?,?)',[school,`${name}-${tag}`,name]);grades.push(grade);rooms.push(await insert('INSERT INTO classrooms(school_id,academic_year_id,grade_level_id,name) VALUES (?,?,?,?)',[school,year,grade,`${name}/1`]));}
  for(const name of ['ผู้จัด ป.5','ผู้จัด ป.4','ครูร่วมสองชั้น','ครูเฉพาะ ป.4'])teachers.push(await insert('INSERT INTO staff(school_id,display_name) VALUES (?,?)',[school,name]));
  const coordinator5=await account('staff','ผู้จัดห้า',teachers[0]),coordinator4=await account('staff','ผู้จัดสี่',teachers[1]);
  for(let i=0;i<2;i++)await pool.query('INSERT INTO grade_coordinators VALUES (?,?,?,?)',[school,term,grades[i],teachers[i]]);
  for(const name of ['คณิต','ศิลปะ'])subjects.push(await insert('INSERT INTO subjects(school_id,code,name) VALUES (?,?,?)',[school,`${name}-${tag}`,name]));
  await pool.query('INSERT INTO teacher_subjects VALUES (?,?,?),(?,?,?)',[school,teachers[2],subjects[0],school,teachers[3],subjects[1]]);
  const slots=[];for(let p=1;p<=2;p++)slots.push(await insert('INSERT INTO teaching_slots(school_id,term_id,weekday,period_number,starts_at,ends_at) VALUES (?,?,1,?,?,?)',[school,term,p,`${7+p}:30`,`${8+p}:30`]));
  await pool.query('INSERT INTO classroom_slots VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?)',[school,term,rooms[0],slots[0],school,term,rooms[1],slots[0],school,term,rooms[1],slots[1]]);
  const requirements=[];for(const [room,teacher,subject] of [[rooms[0],teachers[2],subjects[0]],[rooms[1],teachers[2],subjects[0]],[rooms[1],teachers[3],subjects[1]]])requirements.push(await insert('INSERT INTO teaching_requirements(school_id,term_id,classroom_id,teacher_id,subject_id,periods_per_week,daily_limit) VALUES (?,?,?,?,?,1,1)',[school,term,room,teacher,subject]));
  student=await insert('INSERT INTO students(school_id,code,display_name) VALUES (?,?,?)',[school,tag,'นักเรียนทดสอบ']);await pool.query('INSERT INTO enrollments VALUES (?,?,?,?)',[school,year,student,rooms[0]]);
  const learner=await account('student','นักเรียน');await pool.query('INSERT INTO student_accounts VALUES (?,?,?)',[school,learner.member,student]);
  const open=()=>call(`${url}/timetables/open`,{term_id:term},'POST',coordinator5.cookie);
  const opened=await Promise.all([open(),call(`${url}/timetables/open`,{term_id:term},'POST',coordinator4.cookie)]);assert.ok(opened.every(r=>r.status===200));version=opened[0].data.version.id;assert.equal(opened[1].data.version.id,version);
  let state=opened[0].data;
  const legacy=await insert('INSERT INTO timetable_versions(school_id,term_id,created_by) VALUES (?,?,?)',[school,term,me.data.user.id]);
  assert.equal((await call(`${url}/timetables/${legacy}/clear-auto`,{revision:0,room_ids:[rooms[0]]},'POST',adminCookie)).status,409);

  const get=async()=>{state=(await call(`${url}/timetables/${version}`,undefined,'GET',coordinator4.cookie)).data;return state;};
  const write=(path,body={},cookie=coordinator5.cookie)=>call(`${url}/timetables/${version}${path}`,{revision:state.version.revision,...body},'POST',cookie);
  assert.equal((await write(`/grades/${grades[0]}/complete`)).status,400);
  assert.equal((await write('/auto',{room_ids:[rooms[0]]})).data.complete,true);await get();
  assert.equal((await write(`/grades/${grades[0]}/complete`,{},coordinator4.cookie)).status,403);
  assert.equal((await write(`/grades/${grades[0]}/complete`)).status,200);await get();
  const savedGrade=structuredClone(state.entries.filter(e=>e.classroom_id===rooms[0]));assert.equal(state.gradeCompletion.length,1);
  const portal=await call(`${url}/portal`,undefined,'GET',learner.cookie);assert.equal(portal.data[0].entries.length,1);
  assert.equal((await write(`/grades/${grades[0]}/reopen`,{},coordinator4.cookie)).status,403);
  for(const [path,body] of [['/auto',{room_ids:[rooms[0]]}],['/clear-auto',{room_ids:[rooms[0]]}],[`/entries/${savedGrade[0].id}/unlock`,{}]])assert.equal((await write(path,body)).status,400);
  assert.equal((await write('/clear-auto',{room_ids:rooms},adminCookie)).status,400);
  assert.equal((await call(`${url}/timetables/${version}/entries/${savedGrade[0].id}`,{revision:state.version.revision},'DELETE',coordinator5.cookie)).status,400);
  assert.equal((await call(`${url}/data/classrooms`,{academic_year_id:year,grade_level_id:grades[0],room_number:'2'},'POST',adminCookie)).status,400);
  assert.equal((await call(`${url}/classrooms/${rooms[0]}/slots`,{term_id:term,slots:[slots[0]]},'PUT',adminCookie)).status,400);
  assert.equal((await call(`${url}/requirements`,{term_id:term,classroom_id:rooms[0],subject_id:subjects[1],teacher_id:teachers[3],periods_per_week:1,daily_limit:1},'POST',adminCookie)).status,400);
  const collision=await write('/placement',{requirement_id:requirements[1],slot_id:slots[0]},coordinator4.cookie);assert.equal(collision.status,400);assert.match(collision.data.error,/ป.5\/1/);
  assert.equal((await write('/auto',{room_ids:[rooms[1]]},coordinator4.cookie)).data.complete,true);await get();
  assert.deepEqual(state.entries.filter(e=>e.classroom_id===rooms[0]),savedGrade);
  assert.equal(state.entries.find(e=>e.requirement_id===requirements[1]).slot_id,slots[1]);
  assert.equal((await write(`/grades/${grades[1]}/complete`,{revision:state.version.revision-1},coordinator4.cookie)).status,409);
  assert.equal((await write(`/grades/${grades[1]}/complete`,{},coordinator4.cookie)).status,200);await get();assert.equal(state.gradeCompletion.length,2);
  const allSaved=structuredClone(state.entries);
  assert.equal((await write(`/grades/${grades[0]}/reopen`)).status,200);await get();assert.equal(state.gradeCompletion.length,1);assert.deepEqual(state.entries,allSaved);
  const reopenedPortal=await call(`${url}/portal`,undefined,'GET',learner.cookie);assert.equal(reopenedPortal.data[0].entries.length,0);
  assert.equal((await write('/publish')).status,410);assert.equal((await call(`${url}/timetables`,{term_id:term},'POST',adminCookie)).status,410);
 }finally{
  if(term){await pool.query('DELETE FROM term_timetables WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM timetable_entries WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM timetable_versions WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM grade_coordinators WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM teaching_requirements WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM classroom_slots WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM teaching_slots WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM terms WHERE school_id=? AND id=?',[school,term]);}
  if(student){await pool.query('DELETE FROM student_accounts WHERE school_id=? AND student_id=?',[school,student]);await pool.query('DELETE FROM enrollments WHERE school_id=? AND student_id=?',[school,student]);await pool.query('DELETE FROM students WHERE school_id=? AND id=?',[school,student]);}
  for(const subject of subjects){await pool.query('DELETE FROM teacher_subjects WHERE school_id=? AND subject_id=?',[school,subject]);await pool.query('DELETE FROM subjects WHERE school_id=? AND id=?',[school,subject]);}
  for(const room of rooms)await pool.query('DELETE FROM classrooms WHERE school_id=? AND id=?',[school,room]);
  for(const teacher of teachers)await pool.query('DELETE FROM staff WHERE school_id=? AND id=?',[school,teacher]);
  for(const user of users){await pool.query('DELETE FROM audit_logs WHERE actor_user_id=?',[user]);await pool.query('DELETE FROM sessions WHERE user_id=?',[user]);await pool.query('DELETE FROM memberships WHERE school_id=? AND user_id=?',[school,user]);await pool.query('DELETE FROM users WHERE id=?',[user]);}
  for(const grade of grades)await pool.query('DELETE FROM grade_levels WHERE school_id=? AND id=?',[school,grade]);
  if(year)await pool.query('DELETE FROM academic_years WHERE school_id=? AND id=?',[school,year]);
 }
});
test.after(async()=>{await pool.end();});
