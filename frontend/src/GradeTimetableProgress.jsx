import React from 'react';
import {Check,RefreshCw,Users} from 'lucide-react';
import {Button} from './components';

export default function GradeTimetableProgress({data,state,grade,onGrade,canCoordinate,busy,onComplete,onReopen}){
 const grades=data.grade_levels.filter(g=>state.classrooms.some(r=>Number(r.grade_level_id)===Number(g.id)));
 const progress=grades.map(g=>{
  const rooms=state.classrooms.filter(r=>Number(r.grade_level_id)===Number(g.id));const ids=new Set(rooms.map(r=>Number(r.id)));
  const requirements=state.requirements.filter(r=>ids.has(Number(r.classroom_id)));
  const completion=state.gradeCompletion?.find(c=>Number(c.grade_level_id)===Number(g.id));
  const placed=state.entries.filter(e=>ids.has(Number(e.classroom_id))).length;
  const slots=state.classroomSlots.filter(s=>ids.has(Number(s.classroom_id))).length;
  const quota=requirements.reduce((n,r)=>n+Number(r.periods_per_week),0);
  const remaining=requirements.reduce((n,r)=>n+Math.max(0,Number(r.periods_per_week)-state.entries.filter(e=>Number(e.requirement_id)===Number(r.id)).length),0);
  return {...g,rooms:rooms.length,completion,placed,slots,ready:slots>0&&quota===slots&&remaining===0};
 });
 const current=progress.find(g=>String(g.id)===grade);
 return <section className="panel grade-progress" aria-label="ความคืบหน้าการจัดตารางรายชั้น">
  <div className="grade-progress-heading"><div><h2>จัดตารางรายชั้น · ใช้ตารางครูร่วมกัน</h2><p>บันทึกคาบให้อัตโนมัติทุกครั้ง ชั้นอื่นเห็นคาบครูทันที เมื่อจัดครบให้บันทึกว่าชั้นนี้จัดเสร็จแล้ว</p></div><span className="tag"><Users size={14}/>{progress.filter(g=>g.completion).length} / {progress.length} ชั้นจัดเสร็จ</span></div>
  <div className="grade-progress-list">{progress.map(g=><button key={g.id} disabled={busy} aria-pressed={String(g.id)===grade} className={`${String(g.id)===grade?'selected':''} ${g.completion?'completed':''}`} onClick={()=>onGrade(String(g.id))}><strong>{g.abbreviation||g.name}</strong><span>{g.completion?'จัดเสร็จแล้ว':g.placed?'กำลังจัด':'ยังไม่เริ่ม'}</span><small>{g.placed} / {g.slots} คาบ · {g.rooms} ห้อง</small></button>)}</div>
  {current&&<div className="grade-completion-actions"><div><strong>{current.name} · {current.completion?'จัดเสร็จแล้ว':current.ready?'จัดครบแล้ว พร้อมบันทึก':'กำลังจัดตาราง'}</strong><p>{current.completion?`บันทึกโดย ${current.completion.completed_by_name} · ${new Date(current.completion.completed_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})} · เปิดแก้ไขก่อนเปลี่ยนคาบ`:'คาบครูของชั้นอื่นจะถูกตรวจชนเสมอ การจัด Auto ชั้นนี้จะไม่ย้ายคาบของชั้นอื่น'}</p></div>{canCoordinate&&(current.completion?<Button variant="glass" icon={RefreshCw} loading={busy} onClick={onReopen}>เปิดแก้ไขชั้นนี้</Button>:<Button icon={Check} loading={busy} disabled={!current.ready} onClick={onComplete}>บันทึกว่าจัดเสร็จแล้ว</Button>)}</div>}
 </section>;
}
