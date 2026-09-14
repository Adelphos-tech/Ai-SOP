// ============================================================
// REQUIREMENTS KNOWLEDGE BASE SCHEMA
// Phase SOP-AI-32
// ============================================================
// Reusable university/program/application-writing requirements.
// Isolated in sop_ai_app database.
// ============================================================

export const REQUIREMENTS_SCHEMA_SQL = `
-- ============================================================
-- Institutions table
-- ============================================================
CREATE TABLE IF NOT EXISTS institutions (
  id VARCHAR(36) PRIMARY KEY,
  canonical_name VARCHAR(500) NOT NULL,
  country VARCHAR(100) DEFAULT NULL,
  official_domain VARCHAR(500) DEFAULT NULL,
  additional_official_domains JSON DEFAULT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_institutions_name (canonical_name),
  INDEX idx_institutions_domain (official_domain),
  INDEX idx_institutions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Programs table
-- ============================================================
CREATE TABLE IF NOT EXISTS programs (
  id VARCHAR(36) PRIMARY KEY,
  institution_id VARCHAR(36) NOT NULL,
  program_name VARCHAR(500) NOT NULL,
  degree VARCHAR(255) NOT NULL,
  department VARCHAR(500) DEFAULT NULL,
  school VARCHAR(500) DEFAULT NULL,
  campus VARCHAR(500) DEFAULT NULL,
  country VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_programs_institution (institution_id),
  INDEX idx_programs_name (program_name),
  INDEX idx_programs_degree (degree),
  CONSTRAINT fk_programs_institution FOREIGN KEY (institution_id)
    REFERENCES institutions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Application requirement sets table
-- ============================================================
CREATE TABLE IF NOT EXISTS application_requirement_sets (
  id VARCHAR(36) PRIMARY KEY,
  program_id VARCHAR(36) NOT NULL,
  intake VARCHAR(100) NOT NULL,
  intake_year VARCHAR(10) NOT NULL,
  application_cycle VARCHAR(100) DEFAULT NULL,
  verification_status VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
  ai_policy_status VARCHAR(100) DEFAULT NULL,
  ai_policy_data JSON DEFAULT NULL,
  verified_at TIMESTAMP NULL DEFAULT NULL,
  last_checked_at TIMESTAMP NULL DEFAULT NULL,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  content_hash VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_reqsets_program (program_id),
  INDEX idx_reqsets_intake (intake, intake_year),
  INDEX idx_reqsets_status (verification_status),
  CONSTRAINT fk_reqsets_program FOREIGN KEY (program_id)
    REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Writing requirements table
-- ============================================================
CREATE TABLE IF NOT EXISTS writing_requirements (
  id VARCHAR(36) PRIMARY KEY,
  requirement_set_id VARCHAR(36) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  official_title VARCHAR(500) NOT NULL,
  prompt_text TEXT NOT NULL,
  prompt_source VARCHAR(50) NOT NULL DEFAULT 'OFFICIAL_VERIFIED',
  component_order INT NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  word_min INT DEFAULT NULL,
  word_max INT DEFAULT NULL,
  character_limit INT DEFAULT NULL,
  page_limit INT DEFAULT NULL,
  special_instructions TEXT DEFAULT NULL,
  faculty_instructions TEXT DEFAULT NULL,
  formatting_instructions TEXT DEFAULT NULL,
  verification_status VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_writreq_set (requirement_set_id),
  INDEX idx_writreq_type (document_type),
  CONSTRAINT fk_writreq_set FOREIGN KEY (requirement_set_id)
    REFERENCES application_requirement_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Requirement sources table
-- ============================================================
CREATE TABLE IF NOT EXISTS requirement_sources (
  id VARCHAR(36) PRIMARY KEY,
  requirement_set_id VARCHAR(36) NOT NULL,
  writing_requirement_id VARCHAR(36) DEFAULT NULL,
  source_url TEXT NOT NULL,
  official_domain VARCHAR(500) DEFAULT NULL,
  source_title VARCHAR(500) DEFAULT NULL,
  source_scope VARCHAR(100) NOT NULL DEFAULT 'UNIVERSITY',
  source_type VARCHAR(100) DEFAULT NULL,
  retrieved_at TIMESTAMP NULL DEFAULT NULL,
  verified_at TIMESTAMP NULL DEFAULT NULL,
  content_hash VARCHAR(255) DEFAULT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX reqsrc_set (requirement_set_id),
  INDEX reqsrc_writreq (writing_requirement_id),
  CONSTRAINT fk_reqsrc_set FOREIGN KEY (requirement_set_id)
    REFERENCES application_requirement_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration statements for existing databases.
-- These are NOT executed by init-schema (CREATE TABLE only).
-- Fresh databases get these columns from schema.ts CREATE TABLE.
-- ALTER TABLE applications ADD COLUMN requirement_set_id VARCHAR(36) DEFAULT NULL;
-- ALTER TABLE applications ADD INDEX idx_applications_reqset (requirement_set_id);
-- ALTER TABLE application_documents ADD COLUMN writing_requirement_id VARCHAR(36) DEFAULT NULL;
-- ALTER TABLE application_documents ADD INDEX idx_documents_writreq (writing_requirement_id);
`;
