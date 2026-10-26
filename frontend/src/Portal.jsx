import React,{useState,useEffect} from 'react';
import {GraduationCap,CalendarDays} from 'lucide-react';
import {api,schoolApi,days} from './api';
import {PageHead,Empty} from './components';
export default function Portal({schoolId,notify}){
 const [schedules,setSchedules]=useState([]);
 useEffect(()=>{api.get(schoolApi(schoolId,'/portal')).then(r=>setSchedules(r.data)).catch(e=>notify(e.message,'error'));},[schoolId,notify]);
 return <><PageHead eyebrow="MY CLASSROOM" title="พื้นที่ของห้องเรียน" description="ตารางเรียนของชั้นที่จัดเสร็จแล้ว"/>{!schedules.length?<Empty icon={GraduationCap} title="ยังไม่มีนักเรียนที่เชื่อมกับบัญชีนี้" description="กรุณาติดต่อครูประจำชั้นเพื่อตรวจข้อมูล"/>:schedules.map(({student,entries})=><section className="panel portal-panel" key={student.id}><div className="panel-heading"><div><p className="overline">{student.classroom_name}</p><h2>{student.display_name}</h2></div><span className="tag"><CalendarDays size={14}/>ตารางเรียนที่จัดเสร็จ</span></div>{!entries.length?<Empty title="ชั้นนี้ยังจัดตารางไม่เสร็จ" description="กลับมาดูได้เมื่อผู้จัดตารางบันทึกว่าชั้นนี้จัดเสร็จแล้ว"/>:<div className="table-scroll"><table className="data-table"><thead><tr><th>วัน</th><th>คาบ</th><th>เวลา</th><th>วิชา</th><th>ครู</th></tr></thead><tbody>{entries.map(e=><tr key={e.id}><td>{days[e.weekday]}</td><td>{e.period_number}</td><td>{e.starts_at.slice(0,5)}–{e.ends_at.slice(0,5)}</td><td>{e.subject_name}</td><td>{e.teacher_name}</td></tr>)}</tbody></table></div>}</section>)}</>;
}
