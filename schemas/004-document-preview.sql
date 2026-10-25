CREATE TABLE document_previews (
 plan_id BIGINT UNSIGNED PRIMARY KEY,
 preview_text MEDIUMTEXT NOT NULL,
 FOREIGN KEY (plan_id) REFERENCES lesson_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB;
