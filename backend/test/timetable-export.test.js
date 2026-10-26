import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {exportModel,excelExport,pdfExport} from '../src/timetable-export.js';

export function exportFixture(){
 const data={academic_years:[{id:1,buddhist_year:2569}],terms:[{id:1,academic_year_id:1,term_number:1}],grade_levels:[{id:1,sort_order:1},{id:2,sort_order:2}],staff:[{id:1,display_name:'ครูทดสอบ ก',is_teacher:1},{id:2,display_name:'ครูทดสอบ ข',is_teacher:1}],subjects:[{id:1,name:'คณิตศาสตร์'},{id:2,name:'วิทยาศาสตร์'}]};
 const state={version:{id:7,term_id:1,status:'draft',revision:3},classrooms:[{id:1,name:'ป.5/1',grade_level_id:1},{id:2,name:'ป.6/1',grade_level_id:2}],slots:[],classroomSlots:[],requirements:[{id:1,classroom_id:1,teacher_id:1,subject_id:1,subject_name:'คณิตศาสตร์'},{id:2,classroom_id:2,teacher_id:1,subject_id:2,subject_name:'วิทยาศาสตร์'}],entries:[]};
 for(let day=1;day<=5;day++)for(let period=1;period<=5;period++){
  const slot={id:state.slots.length+1,weekday:day,period_number:period,starts_at:`${String(7+period).padStart(2,'0')}:30:00`,ends_at:`${String(8+period).padStart(2,'0')}:30:00`};state.slots.push(slot);
  for(const room of state.classrooms)state.classroomSlots.push({classroom_id:room.id,slot_id:slot.id});
 }
 state.entries=[{id:1,classroom_id:1,teacher_id:1,requirement_id:1,slot_id:1,source:'manual',locked:1},{id:2,classroom_id:2,teacher_id:1,requirement_id:2,slot_id:2,source:'auto',locked:0}];
 return {state,data,school:{name:'โรงเรียนสาธิตครูฮับ'}};
}

test('export groups weekly lessons by room or teacher without mixing targets or changing the timetable',()=>{
 const {state,data,school}=exportFixture(),before=structuredClone(state);
 const rooms=exportModel(state,data,school,{view:'room',grade_id:1});assert.equal(rooms.sheets.length,1);assert.equal(rooms.sheets[0].count,1);assert.match(rooms.sheets[0].rows[0].cells[0].text,/คณิตศาสตร์\nครูทดสอบ ก/);
 const teacher=exportModel(state,data,school,{view:'teacher',teacher_id:1});assert.equal(teacher.sheets[0].count,2);assert.match(teacher.sheets[0].rows[0].cells[1].text,/วิทยาศาสตร์\nห้อง ป.6\/1/);
 assert.equal(exportModel(state,data,school,{view:'teacher',teacher_id:2}).sheets[0].count,0);
 assert.throws(()=>exportModel(state,data,school,{room_id:999}),{status:404});assert.throws(()=>exportModel(state,data,school,{view:'teacher',grade_id:1}),{status:400});
 state.classroomSlots=state.classroomSlots.filter(s=>s.slot_id!==3);assert.equal(exportModel(state,data,school,{room_id:1}).sheets[0].rows[0].cells[2].text,'ไม่มีคาบเรียน');state.classroomSlots=before.classroomSlots;
 assert.deepEqual(state,before);
});

test('Excel survives round trip with Thai text, safe unique sheet names and print layout',async()=>{
 const {state,data,school}=exportFixture();data.staff[0].display_name='ครู / ทดสอบ';data.staff[1].display_name='ครู : ทดสอบ';
 const buffer=await excelExport(exportModel(state,data,school,{view:'teacher'}));
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);assert.equal(workbook.worksheets.length,2);assert.notEqual(workbook.worksheets[0].name,workbook.worksheets[1].name);
 const sheet=workbook.worksheets.find(s=>s.getCell('A2').value.includes(data.staff[0].display_name));assert.match(sheet.getCell('B6').value,/08:30-09:30\nคณิตศาสตร์\nห้อง ป.5\/1/);assert.equal(sheet.getCell('A6').value,'จันทร์');assert.equal(sheet.pageSetup.orientation,'landscape');assert.equal(sheet.views[0].xSplit,1);assert.ok(sheet.getCell('B6').alignment.wrapText);
});

test('PDF embeds Thai fonts and produces separate landscape pages, including wide schedules',async()=>{
 const {state,data,school}=exportFixture();
 for(let period=6;period<=8;period++)state.slots.push({id:100+period,weekday:1,period_number:period,starts_at:'14:30:00',ends_at:'15:30:00'});
 const buffer=await pdfExport(exportModel(state,data,school));const raw=buffer.toString('latin1');assert.ok(raw.startsWith('%PDF-'));assert.match(raw,/FontFile2/);
 assert.equal((raw.match(/\/Type \/Page\b/g)||[]).length,4);assert.match(raw,/\/MediaBox \[0 0 841\.89 595\.28\]/);
});
