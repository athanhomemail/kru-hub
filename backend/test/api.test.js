import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pool} from '../src/db.js';
import {placementError} from '../src/scheduler.js';
const enabled=process.env.RUN_API_TESTS==='1';
const base='http://127.0.0.1:4001/api';
let cookie='';
async function request(path,body,method='GET',sessionCookie=cookie){
 const headers={'X-KruHub':'1'};if(sessionCookie)headers.Cookie=sessionCookie;
 const options={method,headers};if(body!==undefined){if(body instanceof FormData)options.body=body;else{headers['Content-Type']='application/json';options.body=JSON.stringify(body);}}
 const response=await fetch(`${base}${path}`,options);
 const data=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
 return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('live account, tenant, manual/Auto, publish, export and document-sharing workflow',{skip:!enabled},async()=>{
 const tag=randomUUID().slice(0,8);let otherSchool,staffId,accountId,userId,shareId,planId;
 let schoolId;let versionId;
 try{
  assert.equal((await request('/auth/me',undefined,'GET','')).status,401);
  assert.equal((await fetch(`${base}/auth/demo`,{method:'POST'})).status,403);
  const login=await request('/auth/demo',{},'POST','');assert.equal(login.status,200);cookie=login.cookie;
  const me=await request('/auth/me');assert.equal(me.status,200);schoolId=me.data.schools.find(s=>s.code==='kruhub-demo').id;
  const url=`/schools/${schoolId}`;
  const [other]=await pool.query('INSERT INTO schools(code,name) VALUES (?,?)',[`test-${tag}`,'โรงเรียนทดสอบสิทธิ์']);otherSchool=other.insertId;
  assert.equal((await request(`/schools/${otherSchool}/data`)).status,403);
  const data=(await request(`${url}/data`)).data;
  const term=data.terms[0].id;
  const version=await request(`${url}/timetables`,{term_id:term,empty:true},'POST');assert.equal(version.status,201);versionId=version.data.id;
  let state=(await request(`${url}/timetables/${versionId}`)).data;
  const req=state.requirements[0],slot=state.slots[0];
  // A requirement referenced by prior schedules must not be silently rewritten.
  assert.equal((await request(`${url}/requirements/${req.id}`,{teacher_id:req.teacher_id,periods_per_week:req.periods_per_week,daily_limit:req.daily_limit},'PUT')).status,400);
  const manual=await request(`${url}/timetables/${versionId}/placement`,{revision:state.version.revision,requirement_id:req.id,slot_id:slot.id},'POST');assert.equal(manual.status,200);
  assert.equal((await request(`${url}/timetables/${versionId}/placement`,{revision:0,requirement_id:req.id,slot_id:slot.id},'POST')).status,409);
  state=(await request(`${url}/timetables/${versionId}`)).data;
  const locked=state.entries[0];
  assert.equal((await request(`${url}/timetables/${versionId}/bulk-placement`,{revision:state.version.revision,room_ids:data.classrooms.map(r=>r.id),subject_id:req.subject_id,slot_id:slot.id},'POST')).status,400);
  assert.equal((await request(`${url}/timetables/${versionId}`)).data.entries.length,1);
  const auto=await request(`${url}/timetables/${versionId}/auto`,{revision:state.version.revision,room_ids:data.classrooms.map(r=>r.id)},'POST');assert.equal(auto.status,200);assert.equal(auto.data.complete,true);
  state=(await request(`${url}/timetables/${versionId}`)).data;assert.equal(state.entries.length,75);assert.ok(state.entries.some(e=>e.id===locked.id&&e.source==='manual'));
  for(const entry of state.entries){assert.equal(placementError(state,state.entries.filter(e=>e.id!==entry.id),state.requirements.find(r=>r.id===entry.requirement_id),state.slots.find(s=>s.id===entry.slot_id)),null);}
  const clear=await request(`${url}/timetables/${versionId}/clear-auto`,{revision:state.version.revision,room_ids:data.classrooms.map(r=>r.id)},'POST');assert.equal(clear.status,200);
  state=(await request(`${url}/timetables/${versionId}`)).data;assert.equal(state.entries.length,1);assert.equal(state.entries[0].id,locked.id);
  assert.equal((await request(`${url}/timetables/${versionId}/publish`,{revision:state.version.revision},'POST')).status,400);
  const unavailable=await request(`${url}/unavailable`,{teacher_id:req.teacher_id,term_id:term,slots:[slot.id]},'PUT');assert.equal(unavailable.status,400);
  await request(`${url}/timetables/${versionId}/auto`,{revision:state.version.revision,room_ids:data.classrooms.map(r=>r.id)},'POST');
  state=(await request(`${url}/timetables/${versionId}`)).data;
  const entriesForRoom=state.entries.filter(e=>e.classroom_id===locked.classroom_id);
  let candidate;
  for(const a of entriesForRoom){for(const b of entriesForRoom){if(a.id===b.id)continue;const rest=state.entries.filter(e=>e.id!==a.id&&e.id!==b.id);const reqA=state.requirements.find(r=>r.id===a.requirement_id),reqB=state.requirements.find(r=>r.id===b.requirement_id),slotA=state.slots.find(s=>s.id===a.slot_id),slotB=state.slots.find(s=>s.id===b.slot_id);if(!placementError(state,rest,reqA,slotB,true)&&!placementError(state,[...rest,{...a,slot_id:b.slot_id}],reqB,slotA,true)){candidate=[a,b];break;}}if(candidate)break;}
  assert.ok(candidate,'At least one legal swap');
  assert.equal((await request(`${url}/timetables/${versionId}/move`,{revision:state.version.revision,entry_id:candidate[0].id,slot_id:candidate[1].slot_id,free:true},'POST')).status,200);
  state=(await request(`${url}/timetables/${versionId}`)).data;
  assert.equal((await request(`${url}/timetables/${versionId}/publish`,{revision:state.version.revision},'POST')).status,200);
  const csv=await request(`${url}/timetables/${versionId}/export`);assert.equal(csv.status,200);assert.match(csv.data,/คณิตศาสตร์/);
  assert.equal((await request(`${url}/timetables/${versionId}/clear-auto`,{revision:state.version.revision+1,room_ids:data.classrooms.map(r=>r.id)},'POST')).status,400);
  const staff=await request(`${url}/data/staff`,{code:`test-${tag}`,display_name:'ครูทดสอบสิทธิ์',is_teacher:1,department_id:data.departments[0].id},'POST');assert.equal(staff.status,201);staffId=staff.data.id;
  const account=await request(`${url}/accounts`,{role:'staff',staff_id:staffId,username:`test-${tag}`,display_name:'ครูทดสอบสิทธิ์'},'POST');assert.equal(account.status,201);accountId=account.data.id;
  const [[membership]]=await pool.query('SELECT user_id FROM memberships WHERE id=?',[accountId]);userId=membership.user_id;
  const staffLogin=await request('/auth/login',{username:`test-${tag}`,password:account.data.password},'POST','');assert.equal(staffLogin.status,200);
  let staffCookie=staffLogin.cookie;
  assert.equal((await request(`${url}/data`,undefined,'GET',staffCookie)).status,403);
  const password=await request('/auth/password',{current:account.data.password,password:`Strong-password-${tag}`},'POST',staffCookie);assert.equal(password.status,200);staffCookie=password.cookie;
  assert.equal((await request(`${url}/data`,undefined,'GET',staffCookie)).status,200);
  assert.equal((await request(`${url}/grade-curriculum`,{term_id:term,grade_level_id:data.grade_levels[0].id,items:[]},'PUT',staffCookie)).status,403);
  assert.equal((await request(`${url}/grade-curriculum/apply`,{term_id:term,grade_level_id:data.grade_levels[0].id,assignments:[]},'POST',staffCookie)).status,403);
  assert.equal((await request(`${url}/data/departments`,{name:'ไม่มีสิทธิ์'},'POST',staffCookie)).status,403);
  const form=new FormData();form.set('staff_id',data.staff[0].id);form.set('subject_id',data.subjects[0].id);form.set('grade_level_id',data.grade_levels[0].id);form.set('term_id',term);form.set('title','เอกสารทดสอบ workflow');form.set('lesson_date','2026-10-12');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1EAAAAASUVORK5CYII=','base64');form.set('file',new Blob([png],{type:'image/png'}),'workflow.png');
  const uploaded=await request(`${url}/documents`,form,'POST');assert.equal(uploaded.status,201);planId=uploaded.data.id;
  const shared=await request(`${url}/shares`,{days:1,department_id:data.departments[0].id},'POST');assert.equal(shared.status,201);shareId=shared.data.id;const token=new URL(shared.data.url).pathname.split('/').pop();
  const publicList=await request(`/public/review/${token}`,undefined,'GET','');assert.equal(publicList.status,200);assert.ok(publicList.data.documents.some(d=>d.id===planId));assert.ok(publicList.data.documents.every(d=>!d.file_key));
  const preview=await request(`/public/review/${token}/documents/${planId}/preview`,undefined,'GET','');assert.equal(preview.status,200);
  assert.equal((await request(`${url}/documents/${planId}/file?download=1`,undefined,'GET','')).status,401);
  assert.equal((await request(`${url}/shares/${shareId}`,undefined,'DELETE')).status,200);
  assert.equal((await request(`/public/review/${token}`,undefined,'GET','')).status,404);
  assert.equal((await request(`${url}/documents/${planId}`,undefined,'DELETE')).status,200);planId=null;
  const wordMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  form.set('file',new Blob([await readFile(new URL('./fixtures/lesson.docx',import.meta.url))],{type:wordMime}),'lesson.docx');
  const wordUpload=await request(`${url}/documents`,form,'POST');assert.equal(wordUpload.status,201);planId=wordUpload.data.id;
  const wordPreview=await request(`${url}/documents/${planId}/file`);assert.equal(wordPreview.status,200);assert.match(wordPreview.data.text,/เรียนรู้เศษส่วน/);
  assert.equal((await request(`${url}/documents/${planId}/file?download=1`)).status,200);
  assert.equal((await request(`${url}/documents/${planId}`,undefined,'DELETE')).status,200);planId=null;
  form.set('file',new Blob([await readFile(new URL('./fixtures/unsafe.docx',import.meta.url))],{type:wordMime}),'unsafe.docx');
  assert.equal((await request(`${url}/documents`,form,'POST')).status,400);

 }finally{
  if(planId)await request(`/schools/${schoolId}/documents/${planId}`,undefined,'DELETE');
  if(shareId)await pool.query('DELETE FROM document_shares WHERE id=?',[shareId]);
  if(userId){await pool.query('DELETE FROM sessions WHERE user_id=?',[userId]);await pool.query('DELETE FROM staff WHERE id=?',[staffId]);staffId=null;await pool.query('DELETE FROM memberships WHERE id=?',[accountId]);await pool.query('DELETE FROM users WHERE id=?',[userId]);}
  if(staffId)await pool.query('DELETE FROM staff WHERE id=?',[staffId]);
  if(otherSchool)await pool.query('DELETE FROM schools WHERE id=?',[otherSchool]);
  // The successfully published example remains available for local UI review.
 }
});
test.after(async()=>{await pool.end();});
test('homeroom account creation, guardian privacy and academic-year rollover',{skip:!enabled},async()=>{
 const tag=randomUUID().slice(0,8);let schoolId;const userIds=[];
 try{
  const demo=await request('/auth/demo',{},'POST','');cookie=demo.cookie;const me=(await request('/auth/me')).data;
  const [school]=await pool.query('INSERT INTO schools(code,name) VALUES (?,?)',[`portal-${tag}`,'โรงเรียนทดสอบ Portal']);schoolId=school.insertId;
  await pool.query("INSERT INTO memberships(school_id,user_id,role) VALUES (?,?,'school_admin')",[schoolId,me.user.id]);const url=`/schools/${schoolId}`;
  async function create(entity,body){const r=await request(`${url}/data/${entity}`,body,'POST');assert.equal(r.status,201);return r.data.id;}
  const year=await create('academic_years',{buddhist_year:2570,starts_on:'2027-05-01',ends_on:'2028-04-30',status:'active'});
  const grade=await create('grade_levels',{name:'ป.1',sort_order:1});
  const staff=await create('staff',{code:'T1',display_name:'ครูประจำชั้นทดสอบ',is_teacher:1});
  const room=await create('classrooms',{academic_year_id:year,grade_level_id:grade,name:'ป.1/1',homeroom_teacher_id:staff});
  const otherRoom=await create('classrooms',{academic_year_id:year,grade_level_id:grade,name:'ป.1/2'});
  const student=await create('students',{code:'S1',display_name:'นักเรียนตัวอย่างหนึ่ง'});const otherStudent=await create('students',{code:'S2',display_name:'นักเรียนตัวอย่างสอง'});
  assert.equal((await request(`${url}/enrollments`,{academic_year_id:year,student_id:student,classroom_id:room},'PUT')).status,200);
  assert.equal((await request(`${url}/enrollments`,{academic_year_id:year,student_id:otherStudent,classroom_id:otherRoom},'PUT')).status,200);
  const teacher=await request(`${url}/accounts`,{role:'staff',staff_id:staff,username:`teacher-${tag}`,display_name:'ครูประจำชั้นทดสอบ'},'POST');assert.equal(teacher.status,201);
  const [[teacherMember]]=await pool.query('SELECT user_id FROM memberships WHERE id=?',[teacher.data.id]);userIds.push(teacherMember.user_id);
  async function loginAndChange(username,password){const r=await request('/auth/login',{username,password},'POST','');assert.equal(r.status,200);const p=await request('/auth/password',{current:password,password:`New-strong-pass-${tag}`},'POST',r.cookie);assert.equal(p.status,200);return p.cookie;}
  const teacherCookie=await loginAndChange(`teacher-${tag}`,teacher.data.password);
  assert.equal((await request(`${url}/accounts`,{role:'guardian',student_id:otherStudent,academic_year_id:year,username:`blocked-${tag}`,display_name:'ไม่ควรถูกสร้าง'},'POST',teacherCookie)).status,403);
  const parent=await request(`${url}/accounts`,{role:'guardian',student_id:student,academic_year_id:year,username:`guardian-${tag}`,display_name:'ผู้ปกครองทดสอบ'},'POST',teacherCookie);assert.equal(parent.status,201);
  const [[parentMember]]=await pool.query('SELECT user_id FROM memberships WHERE id=?',[parent.data.id]);userIds.push(parentMember.user_id);
  const parentCookie=await loginAndChange(`guardian-${tag}`,parent.data.password);
  const portal=await request(`${url}/portal`,undefined,'GET',parentCookie);assert.equal(portal.status,200);assert.equal(portal.data.length,1);assert.equal(portal.data[0].student.id,student);
  assert.equal((await request(`${url}/data`,undefined,'GET',parentCookie)).status,403);
  assert.equal((await request(`${url}/rollover`,{academic_year_id:year},'POST')).status,200);
  assert.equal((await request('/auth/me',undefined,'GET',parentCookie)).status,401);
  const [[stillExists]]=await pool.query('SELECT id FROM students WHERE id=?',[student]);assert.ok(stillExists);
  const [[archived]]=await pool.query('SELECT status FROM academic_years WHERE id=?',[year]);assert.equal(archived.status,'archived');
 }finally{
  if(schoolId){
   for(const table of ['audit_logs','guardian_students','student_accounts','enrollments','classrooms','grade_levels','staff','students'])await pool.query(`DELETE FROM ${table} WHERE school_id=?`,[schoolId]);
   for(const u of userIds)await pool.query('DELETE FROM sessions WHERE user_id=?',[u]);
   await pool.query('DELETE FROM memberships WHERE school_id=?',[schoolId]);
   await pool.query('DELETE FROM academic_years WHERE school_id=?',[schoolId]);await pool.query('DELETE FROM schools WHERE id=?',[schoolId]);
   for(const u of userIds)await pool.query('DELETE FROM users WHERE id=?',[u]);
  }
 }
});
