CREATE TABLE term_timetables (
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 version_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (school_id,term_id),
 FOREIGN KEY (school_id,term_id) REFERENCES terms(school_id,id),
 FOREIGN KEY (school_id,term_id,version_id) REFERENCES timetable_versions(school_id,term_id,id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE timetable_grade_completion (
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 grade_level_id BIGINT UNSIGNED NOT NULL,
 completed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 completed_by BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (school_id,term_id,grade_level_id),
 FOREIGN KEY (school_id,term_id) REFERENCES term_timetables(school_id,term_id) ON DELETE CASCADE,
 FOREIGN KEY (school_id,grade_level_id) REFERENCES grade_levels(school_id,id),
 FOREIGN KEY (completed_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Keep all historical schedules intact and use the latest nonempty active schedule.
INSERT INTO term_timetables(school_id,term_id,version_id)
SELECT v.school_id,v.term_id,v.id FROM timetable_versions v
WHERE v.id=(SELECT v2.id FROM timetable_versions v2
 WHERE v2.school_id=v.school_id AND v2.term_id=v.term_id
 ORDER BY (v2.status<>'archived') DESC,
 EXISTS(SELECT 1 FROM timetable_entries e WHERE e.school_id=v2.school_id AND e.version_id=v2.id) DESC,v2.id DESC LIMIT 1);

-- Previously published, complete grades remain completed after the transition.
INSERT INTO timetable_grade_completion(school_id,term_id,grade_level_id,completed_at,completed_by)
SELECT DISTINCT tt.school_id,tt.term_id,c.grade_level_id,COALESCE(v.published_at,v.created_at),v.created_by
FROM term_timetables tt JOIN timetable_versions v ON v.id=tt.version_id AND v.school_id=tt.school_id
JOIN terms t ON t.id=tt.term_id AND t.school_id=tt.school_id
JOIN classrooms c ON c.school_id=t.school_id AND c.academic_year_id=t.academic_year_id
WHERE v.status='published' AND NOT EXISTS(
 SELECT 1 FROM classrooms r WHERE r.school_id=c.school_id AND r.academic_year_id=c.academic_year_id AND r.grade_level_id=c.grade_level_id AND (
 NOT EXISTS(SELECT 1 FROM classroom_slots cs WHERE cs.school_id=r.school_id AND cs.term_id=t.id AND cs.classroom_id=r.id)
 OR (SELECT COALESCE(SUM(q.periods_per_week),0) FROM teaching_requirements q WHERE q.school_id=r.school_id AND q.term_id=t.id AND q.classroom_id=r.id)
 <> (SELECT COUNT(*) FROM classroom_slots cs WHERE cs.school_id=r.school_id AND cs.term_id=t.id AND cs.classroom_id=r.id)
 OR EXISTS(SELECT 1 FROM teaching_requirements q WHERE q.school_id=r.school_id AND q.term_id=t.id AND q.classroom_id=r.id
 AND q.periods_per_week<>(SELECT COUNT(*) FROM timetable_entries e WHERE e.school_id=q.school_id AND e.version_id=v.id AND e.requirement_id=q.id))
 ));
