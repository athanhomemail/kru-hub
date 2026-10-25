CREATE TABLE sessions (
 token_hash CHAR(64) PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX (expires_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE student_accounts (
 school_id BIGINT UNSIGNED NOT NULL,
 membership_id BIGINT UNSIGNED NOT NULL,
 student_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (school_id, membership_id),
 FOREIGN KEY (school_id, membership_id) REFERENCES memberships(school_id, id),
 FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE lesson_plans (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 staff_id BIGINT UNSIGNED NOT NULL,
 subject_id BIGINT UNSIGNED NOT NULL,
 grade_level_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(255) NOT NULL,
 lesson_date DATE NOT NULL,
 file_key VARCHAR(100) NOT NULL,
 original_name VARCHAR(255) NOT NULL,
 mime_type VARCHAR(100) NOT NULL,
 size_bytes INT UNSIGNED NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE (school_id, id), INDEX (school_id, lesson_date),
 FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id),
 FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id),
 FOREIGN KEY (school_id, grade_level_id) REFERENCES grade_levels(school_id, id),
 FOREIGN KEY (school_id, term_id) REFERENCES terms(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE document_shares (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 department_id BIGINT UNSIGNED NULL,
 token_hash CHAR(64) NOT NULL UNIQUE,
 created_by BIGINT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 revoked BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (school_id) REFERENCES schools(id),
 FOREIGN KEY (school_id, department_id) REFERENCES departments(school_id, id),
 FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE media_catalog (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 title VARCHAR(255) NOT NULL,
 description TEXT NOT NULL,
 subject_name VARCHAR(255) NOT NULL,
 grade_name VARCHAR(100) NOT NULL,
 launch_path VARCHAR(255) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB;

ALTER TABLE timetable_versions ADD COLUMN published_term BIGINT UNSIGNED
 GENERATED ALWAYS AS (CASE WHEN status='published' THEN term_id ELSE NULL END) STORED,
 ADD UNIQUE (school_id, published_term);
