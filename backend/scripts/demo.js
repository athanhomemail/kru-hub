import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from '../src/db.js';
import { transaction } from '../src/common.js';
try {
 await transaction(async c=>{
  const [[existing]]=await c.query("SELECT id FROM schools WHERE code='kruhub-demo'");
  if(existing){console.log('Demo school already exists.');return;}
  const insert=async(sql,params)=>(await c.query(sql,params))[0].insertId;
  const school=await insert("INSERT INTO schools(code,name) VALUES ('kruhub-demo','โรงเรียนครูฮับวิทยา · ตัวอย่าง')",[]);
  const user=await insert("INSERT INTO users(username,password_hash,display_name,must_change_password) VALUES ('demo.kruhub',?,'ครูพิมพ์ · ผู้ดูแลตัวอย่าง',FALSE)",[await bcrypt.hash(randomBytes(32).toString('hex'),12)]);
  const member=await insert("INSERT INTO memberships(school_id,user_id,role) VALUES (?,?,'school_admin')",[school,user]);
  const year=await insert("INSERT INTO academic_years(school_id,buddhist_year,starts_on,ends_on,status) VALUES (?,2569,'2026-05-01','2027-04-30','active')",[school]);
  const term=await insert("INSERT INTO terms(school_id,academic_year_id,term_number,starts_on,ends_on) VALUES (?,?,1,'2026-05-01','2026-10-31')",[school,year]);
  const grade=await insert("INSERT INTO grade_levels(school_id,name,sort_order) VALUES (?,'ประถมศึกษาปีที่ 5',5)",[school]);
  const subjects=[],teachers=[];
  const titles=['คณิตศาสตร์','ภาษาไทย','วิทยาศาสตร์','ภาษาอังกฤษ','สังคมศึกษา'];
  const names=['พิมพ์ชนก แสงทอง','อิ๋ว พราวฟ้า','ณัฐพล ใจดี','มะลิ วัฒนกุล','ธนากร มีสุข','สุภาวดี รักเรียน','กิตติพงษ์ แก้วใส','รัตนา ศรีสวัสดิ์'];
  const departments=[];
  for(let i=0;i<5;i++) {
   const dept=await insert('INSERT INTO departments(school_id,name) VALUES (?,?)',[school,titles[i]]);departments.push(dept);
   subjects.push(await insert('INSERT INTO subjects(school_id,department_id,code,name) VALUES (?,?,?,?)',[school,dept,`S${i+1}`,titles[i]]));
  }
  for(let i=0;i<8;i++) teachers.push(await insert('INSERT INTO staff(school_id,membership_id,department_id,code,display_name) VALUES (?,?,?,?,?)',[school,i===0?member:null,departments[i%5],`T${i+1}`,names[i]]));
  for(const teacher of teachers) for(const subject of subjects) await c.query('INSERT INTO teacher_subjects VALUES (?,?,?)',[school,teacher,subject]);
  const slots=[];
  for(let day=1;day<=5;day++) for(let period=1;period<=5;period++) {
   const hour=period<=3?7+period:8+period;
   slots.push(await insert('INSERT INTO teaching_slots(school_id,term_id,weekday,period_number,starts_at,ends_at) VALUES (?,?,?,?,?,?)',[school,term,day,period,`${hour}:30`,`${hour+1}:20`]));
  }
  for(let i=0;i<3;i++){
   const room=await insert('INSERT INTO classrooms(school_id,academic_year_id,grade_level_id,name,homeroom_teacher_id) VALUES (?,?,?,?,?)',[school,year,grade,`ป.5/${i+1}`,teachers[i]]);
   for(const slot of slots) await c.query('INSERT INTO classroom_slots VALUES (?,?,?,?)',[school,term,room,slot]);
   for(let j=0;j<5;j++) await insert('INSERT INTO teaching_requirements(school_id,term_id,classroom_id,subject_id,teacher_id,periods_per_week) VALUES (?,?,?,?,?,5)',[school,term,room,subjects[j],teachers[(j+i)%8]]);
  }
  await c.query('INSERT INTO grade_coordinators VALUES (?,?,?,?)',[school,term,grade,teachers[0]]);
  await c.query('INSERT INTO timetable_versions(school_id,term_id,created_by) VALUES (?,?,?)',[school,term,user]);
  console.log('Created isolated demo school, 3 classrooms, 8 teachers and 25 weekly slots.');
 });
} finally {await pool.end();}
