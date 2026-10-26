import {fail} from './common.js';

// Call while holding the term lock, shared with all timetable/configuration writes.
export async function ensureRoomsOpen(c,school,term,rooms){
 if(!rooms.length)fail(400,'กรุณาเลือกห้องเรียน');
 const [closed]=await c.query('SELECT DISTINCT g.name FROM timetable_grade_completion done JOIN classrooms r ON r.school_id=done.school_id AND r.grade_level_id=done.grade_level_id JOIN grade_levels g ON g.school_id=done.school_id AND g.id=done.grade_level_id WHERE done.school_id=? AND done.term_id=? AND r.id IN (?)',[school,term,rooms]);
 if(closed.length)fail(400,`${closed.map(g=>g.name).join(', ')} จัดเสร็จแล้ว กรุณาเปิดแก้ไขชั้นนี้ก่อน`);
}
