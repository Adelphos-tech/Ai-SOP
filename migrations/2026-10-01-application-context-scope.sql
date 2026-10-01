-- Migration: Application Context Scope
-- Adds application-scoped intake storage to applications so motivation/
-- career/country/requirement intake fields no longer share
-- students.profile_data across all of a student's applications.
--
-- context_data            — JSON { fields: {...}, provenance: {...},
--                           seededAt, updatedAt } holding the
--                           APPLICATION_SCOPE intake keys for THIS
--                           application only.
-- application_context_version — explicit cutover switch (NOT createdAt):
--     1 = LEGACY   — reads fall back to shared students.profile_data
--                    (identical to pre-migration behavior; zero data loss)
--     2 = APP_SCOPED — reads applications.context_data; intake writes
--                    never write app-scope keys back to student scope.
--
-- Existing rows get version 1 (DEFAULT) — deterministic, non-destructive:
-- their observable values are unchanged because the shared profile_data
-- value IS what they read today. No historical per-application values
-- are fabricated.
--
-- New applications are created with version 2 by application code.

ALTER TABLE applications
  ADD COLUMN context_data JSON DEFAULT NULL,
  ADD COLUMN application_context_version INT NOT NULL DEFAULT 1;
