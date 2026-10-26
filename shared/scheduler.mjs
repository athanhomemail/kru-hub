const same = (a,b) => Number(a)===Number(b);
const seconds = value => String(value).split(':').reduce((total,n)=>total*60+Number(n),0) * (String(value).split(':').length===2?60:1);
export function overlaps(a,b) { return same(a.weekday,b.weekday) && seconds(a.starts_at) < seconds(b.ends_at) && seconds(b.starts_at) < seconds(a.ends_at); }
export function placementError(state, entries, requirement, slot, free = false) {
 if(!state.classroomSlots.some(c=>same(c.classroom_id,requirement.classroom_id)&&same(c.slot_id,slot.id))) return 'ห้องนี้ไม่มีคาบเรียนในเวลาที่เลือก';
 if(state.unavailable.some(u=>same(u.teacher_id,requirement.teacher_id)&&overlaps(state.slots.find(s=>same(s.id,u.slot_id)),slot))) return 'ครูไม่ว่างในช่วงเวลานี้';
 for(const entry of entries) {
  const other=state.slots.find(s=>same(s.id,entry.slot_id));
  if(!other || !overlaps(slot,other)) continue;
  if(same(entry.classroom_id,requirement.classroom_id)) return 'ห้องเรียนมีวิชาอยู่ในช่วงเวลานี้แล้ว';
  if(same(entry.teacher_id,requirement.teacher_id)) return 'ครูมีคาบสอนห้องอื่นในช่วงเวลานี้';
 }
 const own=entries.filter(e=>same(e.requirement_id,requirement.id));
 if(own.length>=requirement.periods_per_week) return 'วิชานี้ครบจำนวนคาบต่อสัปดาห์แล้ว';
 const subjectReqs=state.requirements.filter(r=>same(r.classroom_id,requirement.classroom_id)&&(same(r.id,requirement.id)||same(r.subject_id,requirement.subject_id)));
 const subjectIds=new Set(subjectReqs.map(r=>Number(r.id)));
 const dailyLimit=Math.max(...subjectReqs.map(r=>Number(r.daily_limit)));
 if(!free && entries.filter(e=>subjectIds.has(Number(e.requirement_id))&&same(state.slots.find(s=>same(s.id,e.slot_id))?.weekday,slot.weekday)).length>=dailyLimit) return 'วิชานี้ลงครบจำนวนคาบต่อวันแล้ว (รวมครูทุกคน)';
 return null;
}
export function readiness(state,roomIds) {
 const problems=[];
 for(const room of state.classrooms.filter(c=>roomIds.includes(Number(c.id)))) {
  const reqs=state.requirements.filter(r=>same(r.classroom_id,room.id));
  const slots=state.classroomSlots.filter(s=>same(s.classroom_id,room.id));
  const total=reqs.reduce((n,r)=>n+Number(r.periods_per_week),0);
  if(!slots.length || total!==slots.length) problems.push(`${room.name}: กำหนดวิชา ${total} คาบ แต่เปิดเวลาเรียน ${slots.length} คาบ`);
  const days=new Set(slots.map(c=>state.slots.find(s=>same(s.id,c.slot_id))?.weekday)).size;
  for(const subject of new Set(reqs.map(r=>r.subject_id??r.id))){
   const parts=reqs.filter(r=>(r.subject_id??r.id)===subject);
   if(parts.reduce((n,r)=>n+Number(r.periods_per_week),0)>days*Math.max(...parts.map(r=>Number(r.daily_limit))))problems.push(`${room.name}: ${parts[0].subject_name} รวมครูทุกคนมีคาบมากกว่าจำนวนวันที่ลงได้`);
  }
 }
 if(!roomIds.length) problems.push('กรุณาเลือกห้องเรียน');
 return problems;
}
export function solve(state, roomIds, limitMs=1200) {
 const target=new Set(roomIds.map(Number));
 const fixed=state.entries.filter(e=>!target.has(Number(e.classroom_id))||e.source==='manual'||e.locked);
 const reqs=state.requirements.filter(r=>target.has(Number(r.classroom_id)));
 let best=[...fixed]; const end=Date.now()+limitMs;
 for(let attempt=0;attempt<150&&Date.now()<end;attempt++) {
  const entries=[...fixed];
  while(Date.now()<end){
   const options=reqs.map(r=>{
    const remaining=r.periods_per_week-entries.filter(e=>same(e.requirement_id,r.id)).length;
    const candidates=remaining>0?state.slots.filter(s=>!placementError(state,entries,r,s)):[];
    return {r,remaining,candidates,tie:Math.random()};
   }).filter(o=>o.remaining>0&&o.candidates.length);
   if(!options.length) break;
   options.sort((a,b)=>a.candidates.length/a.remaining-b.candidates.length/b.remaining||a.tie-b.tie);
   const {r,candidates}=options[0];
   const slot=candidates[Math.floor(Math.random()*candidates.length)];
   entries.push({classroom_id:r.classroom_id,requirement_id:r.id,teacher_id:r.teacher_id,slot_id:slot.id,source:'auto',locked:0});
  }
  if(entries.length>best.length) best=entries;
  if(reqs.every(r=>best.filter(e=>same(e.requirement_id,r.id)).length===r.periods_per_week)) break;
 }
 const remaining=reqs.map(r=>({...r,remaining:r.periods_per_week-best.filter(e=>same(e.requirement_id,r.id)).length})).filter(r=>r.remaining>0);
 return {entries:best,remaining,complete:!remaining.length};
}
