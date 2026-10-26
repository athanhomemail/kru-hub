CREATE TABLE timetable_published_imports (
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 previous_version_id BIGINT UNSIGNED NOT NULL,
 published_version_id BIGINT UNSIGNED NOT NULL,
 adopted BOOLEAN NOT NULL,
 recorded_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY (school_id,term_id),
 FOREIGN KEY (school_id,term_id) REFERENCES term_timetables(school_id,term_id) ON DELETE CASCADE,
 FOREIGN KEY (school_id,term_id,previous_version_id) REFERENCES timetable_versions(school_id,term_id,id),
 FOREIGN KEY (school_id,term_id,published_version_id) REFERENCES timetable_versions(school_id,term_id,id)
) ENGINE=InnoDB;

-- The approved published schedule wins over a newer experimental draft.
-- If grade workflow has already been used, preserve that newer work for review.
INSERT INTO timetable_published_imports(school_id,term_id,previous_version_id,published_version_id,adopted)
SELECT tt.school_id,tt.term_id,tt.version_id,published.id,
 NOT EXISTS(SELECT 1 FROM audit_logs a JOIN schema_migrations m ON m.name='009-grade-timetable-workflow.sql'
 WHERE a.school_id=tt.school_id AND a.entity_type='timetable' AND a.entity_id=tt.version_id AND a.created_at>=m.applied_at)
 AND NOT EXISTS(SELECT 1 FROM timetable_grade_completion done JOIN schema_migrations m ON m.name='009-grade-timetable-workflow.sql'
 WHERE done.school_id=tt.school_id AND done.term_id=tt.term_id AND done.completed_at>=m.applied_at)
FROM term_timetables tt JOIN timetable_versions published ON published.school_id=tt.school_id AND published.term_id=tt.term_id
WHERE published.status='published' AND published.id=(SELECT MAX(v.id) FROM timetable_versions v WHERE v.school_id=tt.school_id AND v.term_id=tt.term_id AND v.status='published')
AND tt.version_id<>published.id
AND NOT EXISTS(SELECT 1 FROM timetable_published_imports old WHERE old.school_id=tt.school_id AND old.term_id=tt.term_id);

UPDATE term_timetables tt JOIN timetable_published_imports selected ON selected.school_id=tt.school_id AND selected.term_id=tt.term_id
SET tt.version_id=selected.published_version_id WHERE selected.adopted=TRUE;

-- Metadata only: do not rewrite, merge, move or regenerate any lesson.
DELETE done FROM timetable_grade_completion done JOIN timetable_published_imports selected ON selected.school_id=done.school_id AND selected.term_id=done.term_id WHERE selected.adopted=TRUE;

INSERT INTO timetable_grade_completion(school_id,term_id,grade_level_id,completed_at,completed_by)
SELECT DISTINCT tt.school_id,tt.term_id,c.grade_level_id,COALESCE(v.published_at,v.created_at),v.created_by
FROM term_timetables tt JOIN timetable_versions v ON v.id=tt.version_id AND v.school_id=tt.school_id
JOIN terms t ON t.id=tt.term_id AND t.school_id=tt.school_id
JOIN classrooms c ON c.school_id=t.school_id AND c.academic_year_id=t.academic_year_id
WHERE v.status='published'
AND NOT EXISTS(SELECT 1 FROM timetable_grade_completion done WHERE done.school_id=tt.school_id AND done.term_id=tt.term_id AND done.grade_level_id=c.grade_level_id)
AND NOT EXISTS(
 SELECT 1 FROM classrooms r WHERE r.school_id=c.school_id AND r.academic_year_id=c.academic_year_id AND r.grade_level_id=c.grade_level_id AND (
 NOT EXISTS(SELECT 1 FROM classroom_slots cs WHERE cs.school_id=r.school_id AND cs.term_id=t.id AND cs.classroom_id=r.id)
 OR (SELECT COALESCE(SUM(q.periods_per_week),0) FROM teaching_requirements q WHERE q.school_id=r.school_id AND q.term_id=t.id AND q.classroom_id=r.id)
 <> (SELECT COUNT(*) FROM classroom_slots cs WHERE cs.school_id=r.school_id AND cs.term_id=t.id AND cs.classroom_id=r.id)
 OR EXISTS(SELECT 1 FROM teaching_requirements q WHERE q.school_id=r.school_id AND q.term_id=t.id AND q.classroom_id=r.id
 AND q.periods_per_week<>(SELECT COUNT(*) FROM timetable_entries e WHERE e.school_id=q.school_id AND e.version_id=v.id AND e.requirement_id=q.id))
 ));
