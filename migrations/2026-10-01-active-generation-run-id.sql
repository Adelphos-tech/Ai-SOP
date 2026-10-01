-- Generation State Ownership (GEN-004): document-level run ownership.
-- application_documents.active_generation_run_id names the run that is
-- the document's sole authoritative generation attempt.
--
-- SAFETY: nullable column, INSTANT add on MySQL 8.0.12+ / 9.x.
-- If the runtime schema-ensure already applied it on a dev/test
-- environment, the duplicate-column error is harmless — skip.
--
-- Pre-check (expected: 0 before applying):
--   SELECT COUNT(*) FROM generation_runs
--   WHERE status IN ('QUEUED','RUNNING','RECOVERING','CANCEL_REQUESTED');

ALTER TABLE application_documents
  ADD COLUMN active_generation_run_id VARCHAR(36) DEFAULT NULL;
