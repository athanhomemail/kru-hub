import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.js';
test('API assigns 3+2 periods of one subject to two teachers and schedules each quota',{skip:process.env.RUN_API_TESTS!=='1'},async()=>{
 const base='http://127.0.0.1:4001/api';let cookie='',school,year,grade,room,term,subject,version;const teachers=[],requirements=[];
 const insert=async(sql,args)=>(await pool.query(sql,args))[0].insertId;
 async function call(path,body,method='GET'){const r=await fetch(base+path,{method,headers:{'X-KruHub':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
 cookie=(await call('/auth/demo',{},'POST')).cookie;
 school=(await call('/auth/me')).data.schools.find(s=>s.code==='kruhub-demo').id;const url=`/schools/${school}`,tag=randomUUID();
 const [[next]]=await pool.query('SELECT MAX(buddhist_year)+1 AS y FROM academic_years WHERE school_id=?',[school]);
 year=await insert("INSERT INTO academic_years(school_id,buddhist_year,starts_on,ends_on) VALUES (?,?,'2026-05-01','2027-04-30')",[school,next.y]);
 grade=await insert('INSERT INTO grade_levels(school_id,name) VALUES (?,?)',[school,tag]);
 room=await insert('INSERT INTO classrooms(school_id,academic_year_id,grade_level_id,name) VALUES (?,?,?,?)',[school,year,grade,'5/1 แบ่งครู']);
 term=await insert("INSERT INTO terms(school_id,academic_year_id,term_number,starts_on,ends_on) VALUES (?,?,1,'2026-05-01','2026-10-31')",[school,year]);
 subject=await insert('INSERT INTO subjects(school_id,code,name) VALUES (?,?,?)',[school,tag,'คณิตแบ่งครู']);
 for(const name of ['ครู A','ครู B']){const t=await insert('INSERT INTO staff(school_id,display_name) VALUES (?,?)',[school,name]);teachers.push(t);await pool.query('INSERT INTO teacher_subjects VALUES (?,?,?)',[school,t,subject]);}
 assert.equal((await call(`${url}/week`,{term_id:term,days:[1,2,3,4,5],periods:[{start:'08:30',end:'09:20'}]},'POST')).status,200);
 const [slots]=await pool.query('SELECT id FROM teaching_slots WHERE school_id=? AND term_id=? ORDER BY weekday',[school,term]);
 assert.equal((await call(`${url}/classrooms/${room}/slots`,{term_id:term,slots:slots.map(s=>s.id)},'PUT')).status,200);
 for(let i=0;i<2;i++){const result=await call(`${url}/requirements`,{term_id:term,classroom_id:room,subject_id:subject,teacher_id:teachers[i],periods_per_week:i?2:3,daily_limit:1},'POST');assert.equal(result.status,201);requirements.push(result.data.id);}
 assert.equal((await call(`${url}/requirements`,{term_id:term,classroom_id:room,subject_id:subject,teacher_id:teachers[0],periods_per_week:1,daily_limit:1},'POST')).status,400);
 // Editing each teacher allocation remains separate while there are no scheduled entries.
 assert.equal((await call(`${url}/requirements/${requirements[1]}`,{teacher_id:teachers[1],periods_per_week:2,daily_limit:1},'PUT')).status,200);
 const draft=await call(`${url}/timetables`,{term_id:term,empty:true},'POST');assert.equal(draft.status,201);version=draft.data.id;
 let state=(await call(`${url}/timetables/${version}`)).data;
 assert.equal((await call(`${url}/timetables/${version}/placement`,{revision:state.version.revision,requirement_id:requirements[0],slot_id:slots[0].id},'POST')).status,200);
 state=(await call(`${url}/timetables/${version}`)).data;
 const auto=await call(`${url}/timetables/${version}/auto`,{revision:state.version.revision,room_ids:[room]},'POST');assert.equal(auto.status,200);assert.equal(auto.data.complete,true);
 state=(await call(`${url}/timetables/${version}`)).data;
 assert.equal(state.entries.filter(e=>e.teacher_id===teachers[0]).length,3);assert.equal(state.entries.filter(e=>e.teacher_id===teachers[1]).length,2);assert.equal(state.entries.filter(e=>e.source==='manual').length,1);
 assert.equal((await call(`${url}/timetables/${version}/bulk-placement`,{revision:state.version.revision,room_ids:[room],subject_id:subject,slot_id:slots[0].id},'POST')).status,400);
 }finally{
 if(version){await pool.query('DELETE FROM timetable_entries WHERE school_id=? AND version_id=?',[school,version]);await pool.query('DELETE FROM timetable_versions WHERE school_id=? AND id=?',[school,version]);}
 if(term){await pool.query('DELETE FROM teaching_requirements WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM classroom_slots WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM teaching_slots WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM terms WHERE school_id=? AND id=?',[school,term]);}
 if(room)await pool.query('DELETE FROM classrooms WHERE school_id=? AND id=?',[school,room]);
 if(subject){await pool.query('DELETE FROM teacher_subjects WHERE school_id=? AND subject_id=?',[school,subject]);await pool.query('DELETE FROM subjects WHERE school_id=? AND id=?',[school,subject]);}
 for(const t of teachers)await pool.query('DELETE FROM staff WHERE school_id=? AND id=?',[school,t]);
 if(grade)await pool.query('DELETE FROM grade_levels WHERE school_id=? AND id=?',[school,grade]);
 if(year)await pool.query('DELETE FROM academic_years WHERE school_id=? AND id=?',[school,year]);
 }
});
test.after(async()=>{await pool.end();});
