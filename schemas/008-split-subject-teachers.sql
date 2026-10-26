ALTER TABLE teaching_requirements ADD UNIQUE KEY uq_requirement_subject_teacher (school_id,term_id,classroom_id,subject_id,teacher_id);
ALTER TABLE teaching_requirements DROP INDEX school_id;
