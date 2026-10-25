import {fail,id,text} from './common.js';
export function slotBatch(body){
 const days=body.days===undefined?[1,2,3,4,5]:body.days;
 if(!Array.isArray(days)||!days.length||days.length>7)fail(400,'เลือกวันเรียนอย่างน้อย 1 วัน');
 const selected=[...new Set(days.map(id))];if(selected.some(day=>day>7))fail(400,'วันเรียนไม่ถูกต้อง');
 const periods=body.periods;
 if(!Array.isArray(periods)||!periods.length||periods.length>12)fail(400,'กำหนดคาบเรียน 1–12 คาบ');
 const first=id(body.start_period??1);if(first+periods.length-1>24)fail(400,'เลขคาบต้องไม่เกิน 24');
 const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
 for(let i=0;i<periods.length;i++){const p=periods[i];if(!p||!time.test(p.start)||!time.test(p.end)||p.end<=p.start)fail(400,'เวลาเริ่มต้องก่อนเวลาจบ และอยู่ในรูปแบบ HH:mm');if(i&&p.start<periods[i-1].end)fail(400,'คาบเรียนทับซ้อนกัน');}
 return selected.flatMap(day=>periods.map((p,index)=>({weekday:day,period_number:first+index,starts_at:p.start,ends_at:p.end})));
}
export async function insertSlotBatch(c,school,term,body){
 const batch=slotBatch(body);const [[t]]=await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[school,term]);if(!t)fail(404,'ไม่พบภาคเรียน');
 let added=0,skipped=0;
 for(const s of batch){
  const [current]=await c.query('SELECT * FROM teaching_slots WHERE school_id=? AND term_id=? AND weekday=? AND (period_number=? OR (starts_at<? AND ends_at>?))',[school,term,s.weekday,s.period_number,s.ends_at,s.starts_at]);
  if(current.length===1&&Number(current[0].period_number)===s.period_number&&current[0].starts_at===`${s.starts_at}:00`&&current[0].ends_at===`${s.ends_at}:00`){skipped++;continue;}
  if(current.length)fail(400,`วันที่ ${s.weekday} คาบ ${s.period_number} มีคาบเดิมหรือเวลาทับซ้อน กรุณาเปลี่ยนเลขคาบหรือเวลา ระบบยังไม่บันทึกทั้งชุด`);
  await c.query('INSERT INTO teaching_slots(school_id,term_id,weekday,period_number,starts_at,ends_at) VALUES (?,?,?,?,?,?)',[school,term,s.weekday,s.period_number,s.starts_at,s.ends_at]);added++;
 }
 return {added,skipped};
}
export function classroomName(abbreviation,roomNumber){
 const prefix=text(abbreviation,20),number=text(String(roomNumber??''),20);
 if(!/^[0-9]+$/.test(number)||Number(number)<1)fail(400,'เลขห้องต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป');
 return {name:`${prefix}/${number}`,room_number:number};
}
export async function setupFields(c,school,entity,body,creating=false){
 const result={...body};
 if(entity==='grade_levels'){
  result.abbreviation=body.abbreviation==null||String(body.abbreviation).trim()===''?null:text(body.abbreviation,20);
  if(creating&&body.sort_order===undefined){await c.query('SELECT id FROM schools WHERE id=? FOR UPDATE',[school]);const [[row]]=await c.query('SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM grade_levels WHERE school_id=?',[school]);result.sort_order=row.next_order;}
 }
 if(entity==='classrooms'&&body.room_number!=null&&String(body.room_number).trim()!==''){
  const [[grade]]=await c.query('SELECT abbreviation FROM grade_levels WHERE school_id=? AND id=?',[school,id(body.grade_level_id)]);
  if(!grade?.abbreviation)fail(400,'กรุณาเพิ่มตัวย่อชั้นปีก่อนสร้างห้อง เช่น ป.5');
  Object.assign(result,classroomName(grade.abbreviation,body.room_number));
 }
 return result;
}
