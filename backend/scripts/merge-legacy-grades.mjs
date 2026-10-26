import mysql from 'mysql2/promise';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
// stdin mode also works in the old API container, before it contains this file.
const shared=process.env.KRUHUB_MERGE_STDIN==='1'
 ?pathToFileURL(resolve(process.cwd(),'../shared/scheduler.mjs'))
 :new URL('../../shared/scheduler.mjs',import.meta.url);
const {placementError,readiness}=await import(shared);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const lessonKey=e=>[Number(e.classroom_id),Number(e.requirement_id),Number(e.teacher_id),Number(e.slot_id),e.source,Number(e.locked)];
const signature=rows=>digest(rows.map(lessonKey).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
function check(condition,message){if(!condition)throw Error(message);}
function validatePlan(plan){
 check(plan&&typeof plan==='object','Missing grade source plan');
 check(Number.isSafeInteger(plan.school_id)&&plan.school_id>0&&Number.isSafeInteger(plan.term_id)&&plan.term_id>0,'Invalid school or term');
 check(Array.isArray(plan.grades)&&plan.grades.length>0,'No grades selected');
 check(new Set(plan.grades.map(g=>g.grade_level_id)).size===plan.grades.length,'Duplicate grades');
 for(const grade of plan.grades)check(['grade_level_id','source_version_id','expected_lessons'].every(key=>Number.isSafeInteger(grade[key])&&grade[key]>0)&&typeof grade.completed==='boolean','Invalid grade source');
}

export async function inspectMerge(c,plan){
 validatePlan(plan);const school=plan.school_id,term=plan.term_id;
 const [[t]]=await c.query('SELECT * FROM terms WHERE school_id=? AND id=?',[school,term]);check(t,'Term not found');
 const [versions]=await c.query('SELECT * FROM timetable_versions WHERE school_id=? AND term_id=? ORDER BY id',[school,term]);
 if(plan.require_no_published)check(!versions.some(v=>v.status==='published'),'A published schedule now exists. Review the source plan before continuing.');
 const [classrooms]=await c.query('SELECT * FROM classrooms WHERE school_id=? AND academic_year_id=? ORDER BY id',[school,t.academic_year_id]);
 const [slots]=await c.query('SELECT * FROM teaching_slots WHERE school_id=? AND term_id=? ORDER BY id',[school,term]);
 const [requirements]=await c.query('SELECT * FROM teaching_requirements WHERE school_id=? AND term_id=? ORDER BY id',[school,term]);
 const [classroomSlots]=await c.query('SELECT * FROM classroom_slots WHERE school_id=? AND term_id=? ORDER BY classroom_id,slot_id',[school,term]);
 const [unavailable]=await c.query('SELECT * FROM teacher_unavailability WHERE school_id=? AND term_id=? ORDER BY teacher_id,slot_id',[school,term]);
 const [allEntries]=await c.query('SELECT * FROM timetable_entries WHERE school_id=? AND term_id=? ORDER BY id',[school,term]);
 const [grades]=await c.query('SELECT id,name FROM grade_levels WHERE school_id=? ORDER BY id',[school]);
 const selected=[],summary=[];
 for(const choice of plan.grades){
  const version=versions.find(v=>Number(v.id)===choice.source_version_id);check(version,'Source timetable not found in selected school/term');
  const rooms=classrooms.filter(r=>Number(r.grade_level_id)===choice.grade_level_id).map(r=>Number(r.id));check(rooms.length,'Grade has no classrooms in this term');
  const entries=allEntries.filter(e=>Number(e.version_id)===choice.source_version_id&&rooms.includes(Number(e.classroom_id)));
  check(entries.length===choice.expected_lessons,`Source #${choice.source_version_id} grade ${choice.grade_level_id} has ${entries.length} lessons; expected ${choice.expected_lessons}. Review before upgrading.`);
  selected.push(...entries);summary.push({grade:grades.find(g=>Number(g.id)===choice.grade_level_id)?.name,source:choice.source_version_id,lessons:entries.length,status:choice.completed?'completed':'in_progress'});
 }
 const selectedGrades=new Set(plan.grades.map(g=>g.grade_level_id));
 check(!allEntries.some(e=>versions.find(v=>v.id===e.version_id)?.status!=='archived'&&!selectedGrades.has(Number(classrooms.find(r=>r.id===e.classroom_id)?.grade_level_id))),'Another grade has lessons not covered by this plan. Review sources before upgrading.');
 const state={entries:selected,classrooms,slots,requirements,classroomSlots,unavailable};
 for(const entry of selected){
  const requirement=requirements.find(r=>Number(r.id)===Number(entry.requirement_id)),slot=slots.find(s=>Number(s.id)===Number(entry.slot_id));check(requirement&&slot,'Missing requirement or slot');
  const error=placementError(state,selected.filter(e=>e!==entry),requirement,slot,true);check(!error,`Cannot combine existing timetables: ${error}`);
 }
 for(const choice of plan.grades.filter(g=>g.completed)){
  const rooms=classrooms.filter(r=>Number(r.grade_level_id)===choice.grade_level_id).map(r=>Number(r.id));const problems=readiness(state,rooms);check(!problems.length,problems.join(' / '));
  check(!requirements.filter(r=>rooms.includes(Number(r.classroom_id))).some(r=>selected.filter(e=>Number(e.requirement_id)===Number(r.id)).length!==Number(r.periods_per_week)),'Completed grade still has missing lessons');
 }
 const sourceVersions=versions.filter(v=>plan.grades.some(g=>g.source_version_id===Number(v.id)));
 const sourceHash=digest({plan,sources:sourceVersions.map(v=>[v.id,v.revision,v.status]),lessons:signature(selected),classrooms,slots,requirements,classroomSlots,unavailable});
 const planHash=digest(plan);
 const [[tables]]=await c.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='term_timetables'");
 let current=null,alreadyApplied=false;
 if(tables.n){
  [[current]]=await c.query('SELECT version_id FROM term_timetables WHERE school_id=? AND term_id=?',[school,term]);
  const [audits]=await c.query("SELECT entity_id,details FROM audit_logs WHERE school_id=? AND entity_type='timetable' AND action='merge_legacy_grades' ORDER BY id DESC",[school]);
  const match=audits.find(a=>(typeof a.details==='string'?JSON.parse(a.details):a.details)?.planHash===planHash);
  if(match){
   check(Number(current?.version_id)===Number(match.entity_id),'Merged timetable is no longer current; do not reapply this transition');
   check(signature(allEntries.filter(e=>Number(e.version_id)===Number(match.entity_id)))===signature(selected),'Merged timetable has been edited. Use normal updates instead of reapplying this transition.');
   const [done]=await c.query('SELECT grade_level_id FROM timetable_grade_completion WHERE school_id=? AND term_id=? ORDER BY grade_level_id',[school,term]);
   check(JSON.stringify(done.map(d=>Number(d.grade_level_id)).sort())===JSON.stringify(plan.grades.filter(g=>g.completed).map(g=>g.grade_level_id).sort()),'Grade completion has changed. Do not reapply this transition.');alreadyApplied=true;
  }else if(current){
   check(plan.grades.some(g=>g.source_version_id===Number(current.version_id)),'Current timetable differs from the source plan; review before continuing');
   const [[done]]=await c.query('SELECT COUNT(*) AS n FROM timetable_grade_completion WHERE school_id=? AND term_id=?',[school,term]);check(!done.n,'Grade workflow has already been used. Review current work before merging.');
  }
 }
 return {state,selected,allEntries,sourceVersions,summary,sourceHash,planHash,current,alreadyApplied};
}

export async function applyMerge(c,plan,expectedHash){
 await c.beginTransaction();
 try{
  const [[term]]=await c.query('SELECT id FROM terms WHERE school_id=? AND id=? FOR UPDATE',[plan.school_id,plan.term_id]);check(term,'Term not found');
  const inspected=await inspectMerge(c,plan);
  check(!expectedHash||expectedHash===inspected.sourceHash,'Source data changed since preflight. No lessons were merged. Review before retrying.');
  if(inspected.alreadyApplied){await c.commit();return {alreadyApplied:true,version:inspected.current.version_id,grades:inspected.summary,lessons:inspected.selected.length};}
  check(inspected.current,'Run database migrations before applying the grade transition');
  const [[migration]]=await c.query("SELECT status FROM schema_migrations WHERE name='010-preserve-published-timetable.sql'");check(migration?.status==='applied','Database migration 010 is required');
  const originalHash=digest(inspected.allEntries);
  const [created]=await c.query('INSERT INTO timetable_versions(school_id,term_id,created_by) VALUES (?,?,?)',[plan.school_id,plan.term_id,inspected.sourceVersions[0].created_by]);
  await c.query('INSERT INTO timetable_entries(school_id,term_id,version_id,classroom_id,requirement_id,teacher_id,slot_id,source,locked) VALUES ?',[inspected.selected.map(e=>[plan.school_id,plan.term_id,created.insertId,e.classroom_id,e.requirement_id,e.teacher_id,e.slot_id,e.source,e.locked])]);
  await c.query('UPDATE term_timetables SET version_id=? WHERE school_id=? AND term_id=?',[created.insertId,plan.school_id,plan.term_id]);
  for(const grade of plan.grades.filter(g=>g.completed))await c.query('INSERT INTO timetable_grade_completion(school_id,term_id,grade_level_id,completed_by) VALUES (?,?,?,?)',[plan.school_id,plan.term_id,grade.grade_level_id,inspected.sourceVersions.find(v=>v.id===grade.source_version_id).created_by]);
  await c.query("INSERT INTO audit_logs(school_id,action,entity_type,entity_id,details) VALUES (?,'merge_legacy_grades','timetable',?,?)",[plan.school_id,created.insertId,JSON.stringify({planHash:inspected.planHash,sourceHash:inspected.sourceHash,sources:plan.grades})]);
  const [copied]=await c.query('SELECT * FROM timetable_entries WHERE school_id=? AND version_id=?',[plan.school_id,created.insertId]);check(signature(copied)===signature(inspected.selected),'Combined lessons differ from selected source lessons');
  const [originals]=await c.query('SELECT * FROM timetable_entries WHERE school_id=? AND term_id=? AND version_id<>? ORDER BY id',[plan.school_id,plan.term_id,created.insertId]);check(digest(originals)===originalHash,'Original timetables changed');
  await c.commit();return {alreadyApplied:false,version:created.insertId,grades:inspected.summary,lessons:copied.length,originalsPreserved:true};
 }catch(error){await c.rollback();throw error;}
}

async function main(){
 const plan=JSON.parse(process.env.KRUHUB_GRADE_PLAN||'null');validatePlan(plan);
 const connection=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,timezone:'Z'});
 try{
  if(process.argv.includes('--apply')){const expected=JSON.parse(process.env.KRUHUB_GRADE_EXPECTED||'null');check(expected?.sourceHash,'Missing frozen preflight report');console.log(JSON.stringify(await applyMerge(connection,plan,expected.sourceHash)));}
  else{const report=await inspectMerge(connection,plan);console.log(JSON.stringify({sourceHash:report.sourceHash,alreadyApplied:report.alreadyApplied,grades:report.summary,lessons:report.selected.length}));}
 }finally{await connection.end();}
}
if(process.env.KRUHUB_MERGE_STDIN==='1'||(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)))main().catch(error=>{console.error(error.message);process.exitCode=1;});
