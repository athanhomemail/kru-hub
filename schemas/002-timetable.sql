CREATE TABLE teaching_slots (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 weekday TINYINT UNSIGNED NOT NULL,
 period_number TINYINT UNSIGNED NOT NULL,
 starts_at TIME NOT NULL,
 ends_at TIME NOT NULL,
 UNIQUE (school_id, term_id, weekday, period_number), UNIQUE (school_id, term_id, id),
 FOREIGN KEY (school_id, term_id) REFERENCES terms(school_id, id),
 CHECK (weekday BETWEEN 1 AND 7), CHECK (period_number > 0), CHECK (ends_at > starts_at)
) ENGINE=InnoDB;

CREATE TABLE classroom_slots (
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 classroom_id BIGINT UNSIGNED NOT NULL,
 slot_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (school_id, term_id, classroom_id, slot_id),
 FOREIGN KEY (school_id, term_id, slot_id) REFERENCES teaching_slots(school_id, term_id, id),
 FOREIGN KEY (school_id, classroom_id) REFERENCES classrooms(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE teaching_requirements (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 classroom_id BIGINT UNSIGNED NOT NULL,
 subject_id BIGINT UNSIGNED NOT NULL,
 teacher_id BIGINT UNSIGNED NOT NULL,
 periods_per_week TINYINT UNSIGNED NOT NULL,
 daily_limit TINYINT UNSIGNED NOT NULL DEFAULT 1,
 UNIQUE (school_id, term_id, classroom_id, subject_id),
 UNIQUE (school_id, term_id, classroom_id, id),
 UNIQUE (school_id, term_id, classroom_id, teacher_id, id),
 FOREIGN KEY (school_id, term_id) REFERENCES terms(school_id, id),
 FOREIGN KEY (school_id, classroom_id) REFERENCES classrooms(school_id, id),
 FOREIGN KEY (school_id, teacher_id, subject_id) REFERENCES teacher_subjects(school_id, teacher_id, subject_id),
 CHECK (periods_per_week > 0), CHECK (daily_limit > 0)
) ENGINE=InnoDB;

CREATE TABLE teacher_unavailability (
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 teacher_id BIGINT UNSIGNED NOT NULL,
 slot_id BIGINT UNSIGNED NOT NULL,
 reason VARCHAR(255) NULL,
 PRIMARY KEY (school_id, term_id, teacher_id, slot_id),
 FOREIGN KEY (school_id, teacher_id) REFERENCES staff(school_id, id),
 FOREIGN KEY (school_id, term_id, slot_id) REFERENCES teaching_slots(school_id, term_id, id)
) ENGINE=InnoDB;

CREATE TABLE timetable_versions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
 revision INT UNSIGNED NOT NULL DEFAULT 0,
 created_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 published_at TIMESTAMP(6) NULL,
 UNIQUE (school_id, term_id, id),
 FOREIGN KEY (school_id, term_id) REFERENCES terms(school_id, id),
 FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE timetable_entries (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 version_id BIGINT UNSIGNED NOT NULL,
 classroom_id BIGINT UNSIGNED NOT NULL,
 requirement_id BIGINT UNSIGNED NOT NULL,
 teacher_id BIGINT UNSIGNED NOT NULL,
 slot_id BIGINT UNSIGNED NOT NULL,
 source ENUM('manual','auto') NOT NULL,
 locked BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE (school_id, version_id, classroom_id, slot_id),
 UNIQUE (school_id, version_id, teacher_id, slot_id),
 FOREIGN KEY (school_id, term_id, version_id) REFERENCES timetable_versions(school_id, term_id, id),
 FOREIGN KEY (school_id, term_id, classroom_id, teacher_id, requirement_id) REFERENCES teaching_requirements(school_id, term_id, classroom_id, teacher_id, id),
 FOREIGN KEY (school_id, term_id, classroom_id, slot_id) REFERENCES classroom_slots(school_id, term_id, classroom_id, slot_id),
 CHECK (source <> 'manual' OR locked = TRUE)
) ENGINE=InnoDB;
