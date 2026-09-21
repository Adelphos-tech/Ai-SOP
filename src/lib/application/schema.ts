// ============================================================
// DATABASE SCHEMA
// Phase SOP-AI-29
// ============================================================
// Isolated database: sop_ai_app
// Tables: students, applications, application_documents, document_versions,
//         consultants, consultant_sessions
// ============================================================

export const SCHEMA_SQL = `
-- ============================================================
-- Database: sop_ai_app (isolated from D-Vivid production)
-- ============================================================

-- Consultants table (D-Vivid staff who log into the portal)
CREATE TABLE IF NOT EXISTS consultants (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'CONSULTANT',
  organization_id VARCHAR(36) DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_consultants_email (email),
  INDEX idx_consultants_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consultant sessions (DB-backed, httpOnly cookie token)
CREATE TABLE IF NOT EXISTS consultant_sessions (
  id VARCHAR(36) PRIMARY KEY,
  consultant_id VARCHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sessions_token (token_hash),
  INDEX idx_sessions_consultant (consultant_id),
  INDEX idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_consultant FOREIGN KEY (consultant_id)
    REFERENCES consultants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Students table
CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(36) PRIMARY KEY,
  external_ref_id VARCHAR(255) DEFAULT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(500) NOT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  country VARCHAR(100) DEFAULT NULL,
  profile_data JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_students_email (email),
  INDEX idx_students_name (last_name, first_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Applications table
CREATE TABLE IF NOT EXISTS applications (
  id VARCHAR(36) PRIMARY KEY,
  student_id VARCHAR(36) NOT NULL,
  university_name VARCHAR(500) NOT NULL,
  program_name VARCHAR(500) NOT NULL,
  degree VARCHAR(255) NOT NULL,
  department VARCHAR(500) DEFAULT NULL,
  country VARCHAR(100) NOT NULL,
  intake VARCHAR(100) NOT NULL,
  intake_year VARCHAR(10) NOT NULL,
  application_context_id VARCHAR(255) DEFAULT NULL,
  requirement_set_id VARCHAR(36) DEFAULT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_applications_student (student_id),
  INDEX idx_applications_university (university_name),
  INDEX idx_applications_status (status),
  INDEX idx_applications_reqset (requirement_set_id),
  CONSTRAINT fk_applications_student FOREIGN KEY (student_id)
    REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Application documents table
CREATE TABLE IF NOT EXISTS application_documents (
  id VARCHAR(36) PRIMARY KEY,
  application_id VARCHAR(36) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  document_title VARCHAR(500) NOT NULL,
  prompt_text TEXT NOT NULL,
  prompt_source VARCHAR(50) NOT NULL,
  word_min INT DEFAULT NULL,
  word_max INT DEFAULT NULL,
  character_limit INT DEFAULT NULL,
  page_limit INT DEFAULT NULL,
  special_instructions TEXT DEFAULT NULL,
  faculty_instructions TEXT DEFAULT NULL,
  formatting_instructions TEXT DEFAULT NULL,
  mandatory_topics TEXT DEFAULT NULL,
  additional_questions TEXT DEFAULT NULL,
  use_legacy_requirements BOOLEAN NOT NULL DEFAULT FALSE,
  writing_requirement_id VARCHAR(36) DEFAULT NULL,
  requirements_status VARCHAR(50) NOT NULL DEFAULT 'NOT_STARTED',
  generation_status VARCHAR(50) NOT NULL DEFAULT 'NOT_STARTED',
  generation_started_at TIMESTAMP NULL DEFAULT NULL,
  review_status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  current_version_id VARCHAR(36) DEFAULT NULL,
  approved_version_id VARCHAR(36) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_documents_application (application_id),
  INDEX idx_documents_type (document_type),
  INDEX idx_documents_status (generation_status),
  INDEX idx_documents_review_status (review_status),
  INDEX idx_documents_writreq (writing_requirement_id),
  CONSTRAINT fk_documents_application FOREIGN KEY (application_id)
    REFERENCES applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generation runs table — per-attempt lifecycle record.
-- application_documents.generation_status remains the document-level
-- lock/summary; this table carries stage progress, heartbeat and
-- cancellation state for the active attempt.
CREATE TABLE IF NOT EXISTS generation_runs (
  id VARCHAR(36) PRIMARY KEY,
  document_id VARCHAR(36) NOT NULL,
  application_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  current_stage VARCHAR(40) DEFAULT NULL,
  current_stage_started_at DATETIME(3) DEFAULT NULL,
  completed_stages INT NOT NULL DEFAULT 0,
  total_stages INT NOT NULL DEFAULT 6,
  generation_started_at DATETIME(3) DEFAULT NULL,
  last_heartbeat_at DATETIME(3) DEFAULT NULL,
  cancel_requested_at DATETIME(3) DEFAULT NULL,
  cancelled_at DATETIME(3) DEFAULT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  failed_at DATETIME(3) DEFAULT NULL,
  failure_message TEXT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  INDEX idx_runs_document (document_id, created_at),
  INDEX idx_runs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Document versions table
CREATE TABLE IF NOT EXISTS document_versions (
  id VARCHAR(36) PRIMARY KEY,
  document_id VARCHAR(36) NOT NULL,
  version_number INT NOT NULL,
  content LONGTEXT NOT NULL,
  content_format VARCHAR(20) NOT NULL DEFAULT 'MARKDOWN',
  created_by_type VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
  parent_version_id VARCHAR(36) DEFAULT NULL,
  model VARCHAR(100) DEFAULT NULL,
  generation_id VARCHAR(255) DEFAULT NULL,
  student_facts_hash VARCHAR(255) DEFAULT NULL,
  requirements_hash VARCHAR(255) DEFAULT NULL,
  cost_usd DECIMAL(10, 6) DEFAULT NULL,
  cost_inr DECIMAL(10, 2) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_versions_document (document_id),
  INDEX idx_versions_number (document_id, version_number),
  INDEX idx_versions_parent (parent_version_id),
  UNIQUE KEY uq_versions_doc_number (document_id, version_number),
  CONSTRAINT fk_versions_document FOREIGN KEY (document_id)
    REFERENCES application_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phase SOP-AI-34: Migration statements for existing databases.
-- These are NOT executed by init-schema.ts (which only runs CREATE TABLE).
-- For existing databases, run these ALTER statements manually with an admin account.
-- Fresh databases get all columns from the CREATE TABLE statements above.
-- ALTER TABLE application_documents ADD COLUMN review_status VARCHAR(50) NOT NULL DEFAULT 'DRAFT';
-- ALTER TABLE application_documents ADD COLUMN approved_version_id VARCHAR(36) DEFAULT NULL;
-- ALTER TABLE document_versions ADD COLUMN parent_version_id VARCHAR(36) DEFAULT NULL;
-- ALTER TABLE application_documents ADD INDEX idx_documents_review_status (review_status);
-- ALTER TABLE document_versions ADD INDEX idx_versions_parent (parent_version_id);

-- Phase SOP-INFRA-36: Concurrency safety migrations.
-- ALTER TABLE application_documents ADD COLUMN generation_started_at TIMESTAMP NULL DEFAULT NULL;
-- ALTER TABLE document_versions ADD UNIQUE KEY uq_versions_doc_number (document_id, version_number);
`;
