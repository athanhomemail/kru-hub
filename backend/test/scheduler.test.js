import test from 'node:test';
import assert from 'node:assert/strict';
import {solve,placementError,readiness,overlaps} from '../src/scheduler.js';
function fixture(){const slots=[];for(let day=1;day<=5;day++)for(let p=1;p<=2;p++)slots.push({id:(day-1)*2+p,weekday:day,period_number:p,starts_at:`${7+p}:30`,ends_at:`${8+p}:20`});return {slots,classrooms:[{id:1,name:'5/1'},{id:2,name:'5/2'}],classroomSlots:[1,2].flatMap(room=>slots.map(s=>({classroom_id:room,slot_id:s.id}))),requirements:[{id:1,classroom_id:1,teacher_id:1,subject_name:'ไทย',periods_per_week:5,daily_limit:1},{id:2,classroom_id:1,teacher_id:2,subject_name:'คณิต',periods_per_week:5,daily_limit:1},{id:3,classroom_id:2,teacher_id:1,subject_name:'ไทย',periods_per_week:5,daily_limit:1},{id:4,classroom_id:2,teacher_id:2,subject_name:'คณิต',periods_per_week:5,daily_limit:1}],entries:[],unavailable:[]};}
test('Auto preserves manual assignments and prevents shared-teacher conflicts across rooms',()=>{
 const s=fixture();s.entries=[{id:101,classroom_id:1,requirement_id:1,teacher_id:1,slot_id:1,source:'manual',locked:1}];
 const r=solve(s,[1,2]);assert.equal(r.complete,true);assert.equal(r.entries.length,20);assert.deepEqual(r.entries.find(e=>e.id===101),s.entries[0]);
 for(const e of r.entries){const others=r.entries.filter(other=>other!==e);assert.equal(placementError(s,others,s.requirements.find(req=>req.id===e.requirement_id),s.slots.find(slot=>slot.id===e.slot_id)),null);}
});
test('Free manual mode relaxes daily distribution, while retaining teacher conflicts and weekly quota',()=>{
 const s=fixture();const entry={classroom_id:1,requirement_id:1,teacher_id:1,slot_id:1};
 assert.match(placementError(s,[entry],s.requirements[0],s.slots[1]),/ต่อวัน/);
 assert.equal(placementError(s,[entry],s.requirements[0],s.slots[1],true),null);
 assert.match(placementError(s,[entry],s.requirements[2],s.slots[0],true),/ครูมีคาบ/);
 s.unavailable=[{teacher_id:1,slot_id:2}];assert.match(placementError(s,[],s.requirements[0],s.slots[1],true),/ครูไม่ว่าง/);
});
test('Overlapping intervals are conflicts even for distinct slot identifiers',()=>{assert.equal(overlaps({weekday:1,starts_at:'09:00',ends_at:'10:00'},{weekday:1,starts_at:'09:30',ends_at:'10:30'}),true);assert.equal(overlaps({weekday:1,starts_at:'09:00',ends_at:'10:00'},{weekday:1,starts_at:'10:00',ends_at:'11:00'}),false);});
test('Incomplete input is rejected, and impossible schedules return remaining lessons',()=>{const s=fixture();s.requirements[0].periods_per_week=6;assert.ok(readiness(s,[1]).length);s.requirements[0].periods_per_week=5;s.unavailable=s.slots.map(slot=>({teacher_id:1,slot_id:slot.id}));const r=solve(s,[1,2],30);assert.equal(r.complete,false);assert.ok(r.remaining.some(r=>r.teacher_id===1));});
test('one subject can split weekly quota across teachers while sharing its daily limit',()=>{
 const s=fixture();s.classrooms=[s.classrooms[0]];s.classroomSlots=s.classroomSlots.filter(c=>c.classroom_id===1);
 s.requirements=[{id:1,classroom_id:1,subject_id:10,teacher_id:1,subject_name:'คณิต',periods_per_week:3,daily_limit:1},{id:2,classroom_id:1,subject_id:10,teacher_id:3,subject_name:'คณิต',periods_per_week:2,daily_limit:1},{id:3,classroom_id:1,subject_id:20,teacher_id:2,subject_name:'ไทย',periods_per_week:5,daily_limit:1}];
 s.entries=[{id:101,classroom_id:1,requirement_id:1,teacher_id:1,slot_id:1,source:'manual',locked:1}];
 assert.match(placementError(s,s.entries,s.requirements[1],s.slots[1]),/รวมครู/);
 assert.equal(placementError(s,s.entries,s.requirements[1],s.slots[1],true),null);
 assert.deepEqual(readiness(s,[1]),[]);
 const result=solve(s,[1]);assert.equal(result.complete,true);assert.equal(result.entries.filter(e=>e.requirement_id===1).length,3);assert.equal(result.entries.filter(e=>e.requirement_id===2).length,2);assert.ok(result.entries.some(e=>e.id===101));
 for(const entry of result.entries)assert.equal(placementError(s,result.entries.filter(e=>e!==entry),s.requirements.find(r=>r.id===entry.requirement_id),s.slots.find(slot=>slot.id===entry.slot_id)),null);
 s.requirements[1].periods_per_week=3;s.requirements[2].periods_per_week=4;assert.ok(readiness(s,[1]).some(p=>p.includes('รวมครู')));
});
