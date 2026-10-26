import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.js';
test('school setup API creates numbered rooms and bulk slots without overwriting existing data',{skip:process.env.RUN_API_TESTS!=='1'},async()=>{
 const base=process.env.TEST_API_URL||'http://127.0.0.1:4001/api';let cookie='',school,year,term,grade,room;
 async function call(path,body,method='GET'){const r=await fetch(base+path,{method,headers:{'X-KruHub':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
 const login=await call('/auth/demo',{},'POST');assert.equal(login.status,200);cookie=login.cookie;
 const me=await call('/auth/me');school=me.data.schools.find(s=>s.code==='kruhub-demo').id;const url=`/schools/${school}`;
 const [[next]]=await pool.query('SELECT MAX(buddhist_year)+1 AS y FROM academic_years WHERE school_id=?',[school]);
 const r=await call(`${url}/data/academic_years`,{buddhist_year:next.y,starts_on:'2026-05-01',ends_on:'2027-04-30',status:'planning'},'POST');assert.equal(r.status,201);year=r.data.id;
 const g=await call(`${url}/data/grade_levels`,{name:`ชั้นทดสอบ-${randomUUID()}`,abbreviation:'ป.ทดสอบ'},'POST');assert.equal(g.status,201);grade=g.data.id;
 const c=await call(`${url}/data/classrooms`,{academic_year_id:year,grade_level_id:grade,room_number:'1'},'POST');assert.equal(c.status,201);room=c.data.id;
 const [[saved]]=await pool.query('SELECT name,room_number FROM classrooms WHERE id=?',[room]);assert.equal(saved.name,'ป.ทดสอบ/1');assert.equal(saved.room_number,'1');
 const t=await call(`${url}/data/terms`,{academic_year_id:year,term_number:1,starts_on:'2026-05-01',ends_on:'2026-10-31'},'POST');assert.equal(t.status,201);term=t.data.id;
 const body={term_id:term,days:[1,4],start_period:2,periods:[{start:'09:30',end:'10:20'}]};
 const first=await call(`${url}/week`,body,'POST');assert.equal(first.status,200);assert.deepEqual(first.data,{added:2,skipped:0});
 assert.deepEqual((await call(`${url}/week`,body,'POST')).data,{added:0,skipped:2});
 const conflict=await call(`${url}/week`,{...body,days:[2,1],periods:[{start:'09:00',end:'10:00'}]},'POST');assert.equal(conflict.status,400);
 const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM teaching_slots WHERE school_id=? AND term_id=?',[school,term]);assert.equal(count.n,2);
 await call(`${url}/data/grade_levels/${grade}`,{abbreviation:'ใหม่'},'PUT');const [[unchanged]]=await pool.query('SELECT name FROM classrooms WHERE id=?',[room]);assert.equal(unchanged.name,'ป.ทดสอบ/1');
 }finally{
 if(term){await pool.query('DELETE FROM teaching_slots WHERE school_id=? AND term_id=?',[school,term]);await pool.query('DELETE FROM terms WHERE school_id=? AND id=?',[school,term]);}
 if(room)await pool.query('DELETE FROM classrooms WHERE school_id=? AND id=?',[school,room]);
 if(grade)await pool.query('DELETE FROM grade_levels WHERE school_id=? AND id=?',[school,grade]);
 if(year)await pool.query('DELETE FROM academic_years WHERE school_id=? AND id=?',[school,year]);
 }
});
test.after(async()=>{await pool.end();});
