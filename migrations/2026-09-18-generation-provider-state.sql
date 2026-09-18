-- ============================================================
-- Migration: generation provider state (Background Responses)
-- ============================================================
-- Adds provider response persistence to generation_runs and the
-- per-stage responses table used for fingerprint-based reuse,
-- restart recovery, and double-billing protection.
-- Apply as admin (app user lacks ALTER): mysql -u root sop_ai_app < this
-- ============================================================

ALTER TABLE generation_runs
  ADD COLUMN provider_response_id VARCHAR(128) DEFAULT NULL,
  ADD COLUMN provider_response_status VARCHAR(32) DEFAULT NULL,
  ADD COLUMN provider_stage VARCHAR(40) DEFAULT NULL,
  ADD COLUMN provider_started_at DATETIME(3) DEFAULT NULL,
  ADD COLUMN provider_last_checked_at DATETIME(3) DEFAULT NULL,
  ADD COLUMN provider_model VARCHAR(64) DEFAULT NULL,
  ADD COLUMN provider_input_tokens INT DEFAULT NULL,
  ADD COLUMN provider_output_tokens INT DEFAULT NULL,
  ADD COLUMN provider_reasoning_tokens INT DEFAULT NULL,
  ADD COLUMN provider_cached_input_tokens INT DEFAULT NULL,
  ADD COLUMN provider_usage_status VARCHAR(24) DEFAULT NULL,
  ADD COLUMN stage_fingerprint VARCHAR(64) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS generation_stage_responses (
  id VARCHAR(36) PRIMARY KEY,
  run_id VARCHAR(36) NOT NULL,
  document_id VARCHAR(36) NOT NULL,
  stage VARCHAR(40) NOT NULL,
  stage_fingerprint VARCHAR(64) NOT NULL,
  provider_response_id VARCHAR(128) NOT NULL,
  provider_response_status VARCHAR(32) NOT NULL,
  provider_model VARCHAR(64) DEFAULT NULL,
  input_tokens INT DEFAULT NULL,
  cached_input_tokens INT DEFAULT NULL,
  output_tokens INT DEFAULT NULL,
  reasoning_tokens INT DEFAULT NULL,
  usage_status VARCHAR(24) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  completed_at DATETIME(3) DEFAULT NULL,
  INDEX idx_gsr_fingerprint (stage, stage_fingerprint, provider_response_status),
  INDEX idx_gsr_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
