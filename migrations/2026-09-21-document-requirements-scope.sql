-- Migration: Document Requirements Scope
-- Adds document-scoped writing requirement columns to application_documents.
-- Existing documents are marked use_legacy_requirements=TRUE so they keep
-- inheriting from profile.universityRequirements. NEW documents default to
-- FALSE and resolve from document fields → default template only.

ALTER TABLE application_documents
  ADD COLUMN mandatory_topics TEXT DEFAULT NULL,
  ADD COLUMN additional_questions TEXT DEFAULT NULL,
  ADD COLUMN use_legacy_requirements BOOLEAN NOT NULL DEFAULT FALSE;

-- Mark ALL existing documents as legacy — they keep inheriting from
-- profile.universityRequirements for backward compatibility.
UPDATE application_documents SET use_legacy_requirements = TRUE;
