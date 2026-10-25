export function subjectForGrade(data,subjectId,gradeId){
 const grades=(data.subject_grades||[]).filter(g=>Number(g.subject_id)===Number(subjectId));
 return !gradeId||!grades.length||grades.some(g=>Number(g.grade_level_id)===Number(gradeId));
}
export function subjectGradeLabel(data,subjectId){
 const grades=(data.subject_grades||[]).filter(g=>Number(g.subject_id)===Number(subjectId));
 return grades.length?grades.map(g=>data.grade_levels.find(l=>Number(l.id)===Number(g.grade_level_id))?.name).filter(Boolean).join(', '):'ใช้ได้ทุกชั้น / ยังไม่จำกัดชั้น';
}
