import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.js';
import {slotBatch,insertSlotBatch,classroomName,setupFields} from '../src/school-setup.js';
test('multi-day slots validate days, real times, overlaps and starting periods',()=>{
 const body={days:[1,3,5],start_period:6,periods:[{start:'14:30',end:'15:20'}]};
 const slots=slotBatch(body);assert.equal(slots.length,3);assert.equal(slots[0].period_number,6);
 assert.throws(()=>slotBatch({...body,days:[]}),{status:400});
 assert.throws(()=>slotBatch({...body,days:[8]}),{status:400});
 assert.throws(()=>slotBatch({...body,periods:[{start:'25:00',end:'26:00'}]}),{status:400});
 assert.throws(()=>slotBatch({...body,periods:[{start:'08:30',end:'09:30'},{start:'09:00',end:'10:00'}]}),{status:400});
 assert.equal(classroomName('ป.5','1').name,'ป.5/1');
 assert.throws(()=>classroomName('ป.5','0'),{status:400});
});
test('bulk slots add safely, preserve originals, rollback conflicts and generate room names',{skip:process.env.RUN_DB_TESTS!=='1'},async()=>{
 const c=await pool.getConnection();await c.beginTransaction();
 const insert=async(sql,args)=>(await c.query(sql,args))[0].insertId;
 try{
 const school=await insert('INSERT INTO schools(code,name) VALUES (?,?)',[randomUUID(),'ทดสอบเวลาเรียน']);
 const year=await insert("INSERT INTO academic_years(school_id,buddhist_year,starts_on,ends_on) VALUES (?,2569,'2026-05-01','2027-04-30')",[school]);
 const term=await insert("INSERT INTO terms(school_id,academic_year_id,term_number,starts_on,ends_on) VALUES (?,?,1,'2026-05-01','2026-10-31')",[school,year]);
 const body=await setupFields(c,school,'grade_levels',{name:'ประถมศึกษาปีที่ 5',abbreviation:'ป.5'},true);assert.equal(Number(body.sort_order),1);
 const grade=await insert('INSERT INTO grade_levels(school_id,name,abbreviation,sort_order) VALUES (?,?,?,?)',[school,body.name,body.abbreviation,body.sort_order]);
 const next=await setupFields(c,school,'grade_levels',{name:'ประถมศึกษาปีที่ 6',abbreviation:'ป.6'},true);assert.equal(Number(next.sort_order),2);
 const room=await setupFields(c,school,'classrooms',{grade_level_id:grade,room_number:'1'});assert.equal(room.name,'ป.5/1');
 const batch={days:[1,3,5],periods:[{start:'08:30',end:'09:20'},{start:'09:30',end:'10:20'}]};
 assert.deepEqual(await insertSlotBatch(c,school,term,batch),{added:6,skipped:0});
 assert.deepEqual(await insertSlotBatch(c,school,term,batch),{added:0,skipped:6});
 assert.deepEqual(await insertSlotBatch(c,school,term,{days:[2],periods:batch.periods}),{added:2,skipped:0});
 assert.deepEqual(await insertSlotBatch(c,school,term,{days:[1,3,5],start_period:3,periods:[{start:'10:30',end:'11:20'}]}),{added:3,skipped:0});
 await c.query('SAVEPOINT before_conflict');
 await assert.rejects(insertSlotBatch(c,school,term,{days:[4,1],periods:[{start:'08:00',end:'09:00'}]}),{status:400});
 await c.query('ROLLBACK TO SAVEPOINT before_conflict');
 const [[count]]=await c.query('SELECT COUNT(*) AS n FROM teaching_slots WHERE school_id=?',[school]);assert.equal(count.n,11);
 const [[original]]=await c.query('SELECT starts_at FROM teaching_slots WHERE school_id=? AND term_id=? AND weekday=1 AND period_number=1',[school,term]);assert.equal(original.starts_at,'08:30:00');
 await assert.rejects(setupFields(c,school,'classrooms',{grade_level_id:9999999,room_number:'1'}),{status:400});
 }finally{await c.rollback();c.release();}
});
test.after(async()=>{await pool.end();});
