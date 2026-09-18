-- Provider terminal details: error code + incomplete reason.
ALTER TABLE generation_runs
  ADD COLUMN provider_error_code VARCHAR(64) DEFAULT NULL,
  ADD COLUMN provider_incomplete_reason VARCHAR(64) DEFAULT NULL;

ALTER TABLE generation_stage_responses
  ADD COLUMN provider_error_code VARCHAR(64) DEFAULT NULL,
  ADD COLUMN provider_incomplete_reason VARCHAR(64) DEFAULT NULL;
