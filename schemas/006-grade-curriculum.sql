CREATE TABLE subject_grades (
 school_id BIGINT UNSIGNED NOT NULL,
 subject_id BIGINT UNSIGNED NOT NULL,
 grade_level_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (school_id,subject_id,grade_level_id),
 FOREIGN KEY (school_id,subject_id) REFERENCES subjects(school_id,id) ON DELETE CASCADE,
 FOREIGN KEY (school_id,grade_level_id) REFERENCES grade_levels(school_id,id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE grade_curriculum (
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 grade_level_id BIGINT UNSIGNED NOT NULL,
 subject_id BIGINT UNSIGNED NOT NULL,
 periods_per_week TINYINT UNSIGNED NOT NULL,
 daily_limit TINYINT UNSIGNED NOT NULL DEFAULT 1,
 PRIMARY KEY (school_id,term_id,grade_level_id,subject_id),
 FOREIGN KEY (school_id,term_id) REFERENCES terms(school_id,id),
 FOREIGN KEY (school_id,grade_level_id) REFERENCES grade_levels(school_id,id),
 FOREIGN KEY (school_id,subject_id) REFERENCES subjects(school_id,id),
 CHECK (periods_per_week BETWEEN 1 AND 60),
 CHECK (daily_limit BETWEEN 1 AND 12)
) ENGINE=InnoDB;
