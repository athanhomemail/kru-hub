CREATE TABLE schools (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 code VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(255) NOT NULL,
 timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok',
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 username VARCHAR(100) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 display_name VARCHAR(255) NOT NULL,
 is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
 must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE academic_years (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 buddhist_year SMALLINT UNSIGNED NOT NULL,
 starts_on DATE NOT NULL,
 ends_on DATE NOT NULL,
 status ENUM('planning','active','archived') NOT NULL DEFAULT 'planning',
 UNIQUE (school_id, buddhist_year), UNIQUE (school_id, id),
 FOREIGN KEY (school_id) REFERENCES schools(id),
 CHECK (ends_on >= starts_on)
) ENGINE=InnoDB;

CREATE TABLE terms (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 academic_year_id BIGINT UNSIGNED NOT NULL,
 term_number TINYINT UNSIGNED NOT NULL,
 starts_on DATE NOT NULL,
 ends_on DATE NOT NULL,
 UNIQUE (school_id, academic_year_id, term_number), UNIQUE (school_id, id),
 FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id),
 CHECK (ends_on >= starts_on)
) ENGINE=InnoDB;

CREATE TABLE memberships (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 role ENUM('school_admin','staff','student','guardian') NOT NULL,
 academic_year_id BIGINT UNSIGNED NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE (school_id, user_id), UNIQUE (school_id, id),
 FOREIGN KEY (school_id) REFERENCES schools(id),
 FOREIGN KEY (user_id) REFERENCES users(id),
 FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id),
 CHECK (role NOT IN ('student','guardian') OR academic_year_id IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE departments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(255) NOT NULL,
 UNIQUE (school_id, name), UNIQUE (school_id, id),
 FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB;

CREATE TABLE staff (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 membership_id BIGINT UNSIGNED NULL,
 department_id BIGINT UNSIGNED NULL,
 code VARCHAR(40) NOT NULL,
 display_name VARCHAR(255) NOT NULL,
 is_teacher BOOLEAN NOT NULL DEFAULT TRUE,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE (school_id, code), UNIQUE (school_id, id), UNIQUE (school_id, membership_id),
 FOREIGN KEY (school_id) REFERENCES schools(id),
 FOREIGN KEY (school_id, membership_id) REFERENCES memberships(school_id, id),
 FOREIGN KEY (school_id, department_id) REFERENCES departments(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE subjects (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 department_id BIGINT UNSIGNED NULL,
 code VARCHAR(40) NOT NULL,
 name VARCHAR(255) NOT NULL,
 UNIQUE (school_id, code), UNIQUE (school_id, id),
 FOREIGN KEY (school_id) REFERENCES schools(id),
 FOREIGN KEY (school_id, department_id) REFERENCES departments(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE teacher_subjects (
 school_id BIGINT UNSIGNED NOT NULL,
 teacher_id BIGINT UNSIGNED NOT NULL,
 subject_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (school_id, teacher_id, subject_id),
 FOREIGN KEY (school_id, teacher_id) REFERENCES staff(school_id, id),
 FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE grade_levels (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(100) NOT NULL,
 sort_order SMALLINT NOT NULL DEFAULT 0,
 UNIQUE (school_id, name), UNIQUE (school_id, id),
 FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB;

CREATE TABLE classrooms (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 academic_year_id BIGINT UNSIGNED NOT NULL,
 grade_level_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(100) NOT NULL,
 homeroom_teacher_id BIGINT UNSIGNED NULL,
 UNIQUE (school_id, academic_year_id, grade_level_id, name), UNIQUE (school_id, id),
 FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id),
 FOREIGN KEY (school_id, grade_level_id) REFERENCES grade_levels(school_id, id),
 FOREIGN KEY (school_id, homeroom_teacher_id) REFERENCES staff(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE grade_coordinators (
 school_id BIGINT UNSIGNED NOT NULL,
 term_id BIGINT UNSIGNED NOT NULL,
 grade_level_id BIGINT UNSIGNED NOT NULL,
 staff_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (school_id, term_id, grade_level_id),
 FOREIGN KEY (school_id, term_id) REFERENCES terms(school_id, id),
 FOREIGN KEY (school_id, grade_level_id) REFERENCES grade_levels(school_id, id),
 FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE students (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(40) NOT NULL,
 display_name VARCHAR(255) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE (school_id, code), UNIQUE (school_id, id),
 FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB;

CREATE TABLE enrollments (
 school_id BIGINT UNSIGNED NOT NULL,
 academic_year_id BIGINT UNSIGNED NOT NULL,
 student_id BIGINT UNSIGNED NOT NULL,
 classroom_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (school_id, academic_year_id, student_id),
 FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id),
 FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
 FOREIGN KEY (school_id, classroom_id) REFERENCES classrooms(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE guardian_students (
 school_id BIGINT UNSIGNED NOT NULL,
 membership_id BIGINT UNSIGNED NOT NULL,
 student_id BIGINT UNSIGNED NOT NULL,
 relationship VARCHAR(100) NULL,
 PRIMARY KEY (school_id, membership_id, student_id),
 FOREIGN KEY (school_id, membership_id) REFERENCES memberships(school_id, id),
 FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
) ENGINE=InnoDB;

CREATE TABLE school_holidays (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NOT NULL,
 holiday_date DATE NOT NULL,
 name VARCHAR(255) NOT NULL,
 UNIQUE (school_id, holiday_date),
 FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 school_id BIGINT UNSIGNED NULL,
 actor_user_id BIGINT UNSIGNED NULL,
 action VARCHAR(100) NOT NULL,
 entity_type VARCHAR(100) NOT NULL,
 entity_id BIGINT UNSIGNED NULL,
 details JSON NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 INDEX (school_id, created_at),
 FOREIGN KEY (school_id) REFERENCES schools(id),
 FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
