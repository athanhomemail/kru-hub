import React,{useState} from 'react';
import {Download,FileSpreadsheet,FileText} from 'lucide-react';
import {api,schoolApi} from './api';
import {Button,Field,Modal} from './components';

export default function TimetableExport({data,schoolId,state,view,roomId,teacherId,grade,onClose,notify}){
 const [kind,setKind]=useState(view),[scope,setScope]=useState('selected'),[room,setRoom]=useState(roomId||String(state.classrooms[0]?.id||'')),[teacher,setTeacher]=useState(teacherId||String(data.staff.find(t=>t.is_teacher)?.id||'')),[gradeId,setGrade]=useState(grade),[busy,setBusy]=useState('');
 const teachers=data.staff.filter(t=>t.is_teacher||state.entries.some(e=>Number(e.teacher_id)===Number(t.id)));
 const disabled=!!busy||(scope==='selected'&&!(kind==='room'?room:teacher))||(scope==='grade'&&!gradeId);
 async function save(format){
  if(disabled)return;setBusy(format);
  try{
   const query=new URLSearchParams({format,view:kind});
   if(scope==='selected')query.set(kind==='room'?'room_id':'teacher_id',kind==='room'?room:teacher);
   if(scope==='grade')query.set('grade_id',gradeId);
   const response=await api.get(schoolApi(schoolId,`/timetables/${state.version.id}/download?${query}`),{responseType:'blob'});
   const url=URL.createObjectURL(response.data);const link=document.createElement('a');link.href=url;link.download=`kruhub-${kind}-${state.version.id}.${format}`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   notify(`ดาวน์โหลด ${format==='pdf'?'PDF':'Excel'} แล้ว`);
  }catch(error){let message=error.message;if(error.response?.data instanceof Blob){try{message=JSON.parse(await error.response.data.text()).error||message;}catch{}}notify(message,'error');}
  finally{setBusy('');}
 }
 return <Modal title="ดาวน์โหลดตารางเรียน / ตารางสอน" onClose={busy?()=>{}:onClose}>
  <p className="form-note">วันอยู่ทางซ้าย คาบอยู่ด้านบน พร้อมเวลา วิชา และครูหรือห้องเรียน ดาวน์โหลดได้ทั้งฉบับร่างและฉบับที่เผยแพร่แล้ว</p>
  <div className="form-grid">
   <Field label="ประเภทตาราง"><select value={kind} disabled={!!busy} onChange={e=>{setKind(e.target.value);setScope('selected');}}><option value="room">ตารางเรียนแยกห้อง</option><option value="teacher">ตารางสอนแยกครู</option></select></Field>
   <Field label="ต้องการดาวน์โหลด"><select value={scope} disabled={!!busy} onChange={e=>setScope(e.target.value)}><option value="selected">{kind==='room'?'ห้องเดียว':'ครูคนเดียว'}</option>{kind==='room'&&<option value="grade">ทุกห้องในชั้นปี</option>}<option value="all">{kind==='room'?'ทุกห้องในภาคเรียน':'ครูทั้งหมด'}</option></select></Field>
  </div>
  {scope==='selected'&&(kind==='room'?<Field label="ห้องเรียน"><select value={room} disabled={!!busy} onChange={e=>setRoom(e.target.value)}><option value="">เลือกห้องเรียน</option>{state.classrooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>:<Field label="ครู"><select value={teacher} disabled={!!busy} onChange={e=>setTeacher(e.target.value)}><option value="">เลือกครู</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.display_name}</option>)}</select></Field>)}
  {scope==='grade'&&<Field label="ชั้นปี"><select value={gradeId} disabled={!!busy} onChange={e=>setGrade(e.target.value)}><option value="">เลือกชั้นปี</option>{data.grade_levels.filter(g=>state.classrooms.some(r=>Number(r.grade_level_id)===Number(g.id))).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>}
  <div className="export-format-note"><FileText size={22}/><div><strong>PDF พร้อมพิมพ์</strong><p>กระดาษ A4 แนวนอน แยกหน้าตามห้องหรือครู ถ้าคาบมากจะแบ่งหน้าต่อเนื่องให้อ่านได้ชัดเจน</p></div></div>
  <div className="export-format-note"><FileSpreadsheet size={22}/><div><strong>Excel แก้ไขต่อได้</strong><p>แยกชีตตามห้องหรือครู จัดสีรายวิชา ตรึงหัวตาราง และตั้งค่าหน้าพิมพ์ให้แล้ว</p></div></div>
  <div className="modal-actions"><Button icon={Download} disabled={disabled} loading={busy==='pdf'} onClick={()=>save('pdf')}>ดาวน์โหลด PDF</Button><Button variant="glass" icon={FileSpreadsheet} disabled={disabled} loading={busy==='xlsx'} onClick={()=>save('xlsx')}>ดาวน์โหลด Excel</Button></div>
 </Modal>;
}
