-- Provider error message (diagnostic only — never surfaced raw in UI).
ALTER TABLE generation_runs
  ADD COLUMN provider_error_message TEXT DEFAULT NULL;
