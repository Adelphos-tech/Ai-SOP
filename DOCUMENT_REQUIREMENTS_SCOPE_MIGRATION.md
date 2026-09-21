# Document Requirements Scope Migration

## Problem

Writing requirements were collected twice:
1. During application/intake as `profile.universityRequirements` (one generic prompt, word limits, topics, questions, formatting)
2. During Add Document (document type, prompt, consultant instruction, length options)

With multiple documents per application (SOP, Visa SOP, Essay 1, Essay 2, LOR, etc.), one generic application-level writing prompt/limit/topic set is ambiguous and bleeds into unrelated documents.

Example: Application-level SOP prompt → new Visa SOP → inherited incorrectly.

## Solution

Corrected the scope:

| Level | Owns |
|-------|------|
| APPLICANT | Reusable student facts |
| APPLICATION | University/program/country/intake/general context |
| DOCUMENT | Exact writing requirements for THIS document |

## Changes

### Database Migration

Added three columns to `application_documents`:

```sql
ALTER TABLE application_documents
  ADD COLUMN mandatory_topics TEXT DEFAULT NULL,
  ADD COLUMN additional_questions TEXT DEFAULT NULL,
  ADD COLUMN use_legacy_requirements BOOLEAN NOT NULL DEFAULT FALSE;
```

Existing documents are marked `use_legacy_requirements = TRUE` for backward compatibility.

### Intake UI (Section 8)

Removed document-writing-specific fields from the application intake:
- Document Prompt / Question
- Word Min / Max
- Character Limit
- Page Limit
- Mandatory Topics
- University-Specific Questions
- Formatting Rules

Renamed section to "Program / University Info" — now only collects:
- Official Source URL (reusable program/university context)

### Add Document Form

Added document-scoped writing requirement fields to Advanced Options:
- Word Min / Max / Character Limit / Page Limit (existing)
- Mandatory Topics (one per line) — NEW
- Additional / Specific Questions (one per line) — NEW
- Formatting Rules — NEW

### Resolver (`resolveAndMergePrompt`)

**Legacy documents** (`use_legacy_requirements = TRUE`):
- Keep inheriting from `profile.universityRequirements` for word limits, topics, questions, formatting
- Backward compatible — no behavior change

**New documents** (`use_legacy_requirements = FALSE`):
- Resolve from document fields → writing requirement → default template only
- Do NOT inherit from `profile.universityRequirements`
- Document-scoped `mandatory_topics` and `additional_questions` used directly

### Resolution Precedence (unchanged)

```
explicit document prompt
→ document-type-specific verified requirement
→ D-Vivid document-type default
```

### Default Template Re-resolution (preserved)

`DVIVID_DEFAULT_TEMPLATE` documents continue to resolve against the CURRENT canonical default template, not a persisted snapshot.

## Verification

- Typecheck: PASS
- Build: PASS
- Tests: 15/15
- OpenAI calls: 0
- Document generations: 0

## Files Changed

- `migrations/2026-09-21-document-requirements-scope.sql` — DB migration
- `src/lib/application/schema.ts` — schema with new columns
- `src/lib/application/application-types.ts` — CreateDocumentInput + ApplicationDocument interfaces
- `src/lib/application/application-repository.ts` — createDocument + rowToDocument with new fields
- `src/lib/application/generation-context.ts` — resolveAndMergePrompt with legacy cutover
- `src/app/api/application/document/route.ts` — accept new fields in POST body
- `src/app/students/[studentId]/applications/[applicationId]/intake/[step]/page.tsx` — removed document-writing fields from Section 8
- `src/app/students/[studentId]/applications/[applicationId]/page.tsx` — added topics/questions/formatting to Add Document form
- `src/lib/application/intake-completion.ts` — renamed Section 8 label
- `scripts/generation-preflight.ts` — Document Requirement Scope diagnostics
- `tests/document-requirements-scope.test.ts` — 15 deterministic tests
