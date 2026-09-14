# PHASE SOP-AI-34: CONSULTANT REVIEW WORKFLOW

**Date:** 2026-09-11
**Status:** COMPLETE
**Phase Type:** Product Workflow (NOT an AI phase)

---

## Summary

Implemented the consultant document review workflow for the D-Vivid Consultant
Application Writing Platform. Consultants can now open AI-generated documents,
edit them in a multiline editor, save new versions, compare versions, and approve
a selected version as final.

The six-stage AI pipeline remains release-locked and unmodified. No OpenAI calls
were made during this phase.

---

## Implementation

### Schema Changes

Added three new columns to support review and approval state:

```sql
ALTER TABLE application_documents ADD COLUMN review_status VARCHAR(50) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE application_documents ADD COLUMN approved_version_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE document_versions ADD COLUMN parent_version_id VARCHAR(36) DEFAULT NULL;
```

Existing D-Vivid schemas remain unchanged. Migration executed via admin connection
(runtime account remains DML-only).

### Repository (`application-repository.ts`)

Added:
- `validateDocumentOwnership(documentId, applicationId, studentId)` — validates the full hierarchy
- `validateVersionOwnership(versionId, documentId)` — validates version belongs to document
- `saveConsultantVersion(input)` — server-authoritative consultant version creation:
  - Forces `createdByType = CONSULTANT_EDITED` server-side
  - Assigns `versionNumber = MAX + 1` server-side
  - Rejects empty content
  - Rejects identical content (compared to base version)
  - Records `parentVersionId` for lineage
  - Updates `currentVersionId` on document
  - Returns review status to `IN_REVIEW` if previously `APPROVED`
- `approveDocumentVersion(documentId, versionId)` — server-side approval:
  - Validates version belongs to document
  - Validates word min/max and character limit
  - Sets `approvedVersionId` and `reviewStatus = APPROVED`
  - Does NOT alter version text

### API Endpoints

**POST `/api/application/version`** (updated):
- Consultant edit path: validates student/application/document ownership, calls `saveConsultantVersion`
- AI generation path: unchanged (still calls `createDocumentVersion` directly)
- Browser cannot forge `AI_GENERATED` — consultant path forces `CONSULTANT_EDITED` server-side

**POST `/api/application/version/approve`** (new):
- Validates full hierarchy: studentId → applicationId → documentId → versionId
- Calls `approveDocumentVersion` with hard-limit validation
- Returns 400 on constraint violation, 403 on access denied

**GET `/api/application/version`** (unchanged):
- Lists versions for a document

### Document Workspace UI

Transformed the read-only viewer at:
```
/students/<studentId>/applications/<applicationId>/documents/<documentId>
```
into a full consultant review workspace with:

- **Document Header**: title, type, prompt source, generation status, review status, approved version badge
- **Prompt / Instructions** (collapsible): prompt text, word/char limits, special/faculty/formatting instructions
- **Editor**: multiline textarea with:
  - Word count and character count (live)
  - Unsaved changes indicator
  - Word limit warnings (over max, under min)
  - "Save New Version" button
  - Save success/error feedback
- **Approval**: approve selected version with confirmation dialog
- **Version History**: list of all versions with:
  - Version number, creator type, model, cost
  - Approved/Current badges
  - "View", "Edit from here", "Approve" actions per version
  - Word count per version
  - Content preview

### Application Workspace

Document cards now display review status badge alongside generation status:
- `DRAFT` (gray)
- `IN_REVIEW` (blue)
- `APPROVED` (green)

---

## Test Results

### Phase 34 Tests (A-Z)

```
tests/phase-34-consultant-review-workflow-tests.ts
=== Results: 68 passed, 0 failed ===
```

| Test | Description | Result |
|------|-------------|--------|
| A | AI Version 1 preserved | PASS |
| B | Consultant edit creates Version 2 | PASS |
| C | Second edit creates Version 3 | PASS |
| D | Previous version content unchanged | PASS |
| E | Server assigns version number | PASS |
| F | CONSULTANT_EDITED assigned server-side | PASS |
| G | AI_GENERATED cannot be forged from browser | PASS |
| H | Empty content rejected | PASS |
| I | Identical save prevented/warned | PASS |
| J | currentVersionId updated | PASS |
| K | approvedVersionId explicit | PASS |
| L | Approval does not alter text | PASS |
| M | Old version can be approved | PASS |
| N | New edit after approval doesn't silently approve | PASS |
| O | Word max blocks approval | PASS |
| P | Word min blocks approval | PASS |
| Q | Character limit blocks approval | PASS |
| R | Corrected document can be approved | PASS |
| S | Cross-document version access blocked | PASS |
| T | Cross-student access blocked | PASS |
| U | Student facts unchanged by edit | PASS |
| V | Zero OpenAI calls | PASS |
| W | Six-stage AI pipeline unchanged | PASS |
| X | Browser refresh persists versions | PASS |
| Y | Separate documents isolated | PASS |
| Z | Approved status appears correctly | PASS |

### Regression Suites

| Suite | Result |
|-------|--------|
| Phase 34 | 68/68 PASS |
| Phase 33B | 40/40 PASS |
| Phase 33 | 196/196 PASS |
| TypeScript | PASS |

### Build

```
rm -rf .next && npm run build
```
- Clean build: PASS
- `.next/prerender-manifest.json` generated naturally: PASS

---

## Editor

| Feature | Result |
|---------|--------|
| Generated text editable | PASS |
| Unsaved changes indicator | PASS |
| Word count | PASS |
| Character count | PASS |

## Versioning

| Feature | Result |
|---------|--------|
| AI Version 1 preserved | PASS |
| Consultant Version 2 | PASS |
| Further versions | PASS |
| Previous versions immutable | PASS |

## Approval

| Feature | Result |
|---------|--------|
| Explicit approved version | PASS |
| Approve old version | PASS |
| Hard limits validated | PASS |
| Editing after approval safe | PASS |

## Isolation

| Feature | Result |
|---------|--------|
| Documents isolated | PASS |
| Students isolated | PASS |
| Student facts modified by editing | NO (expected) |

## AI

| Metric | Value |
|--------|-------|
| OpenAI calls | 0 |
| Six-stage pipeline modified | NO |

## Production

| Check | Result |
|-------|--------|
| SOP backend (5010) | 200 |
| Frontend (5002) | 200 |
| Public frontend (https) | 200 |
| nginx | active |
| Unexpected PM2 delta | 0 |
| Production impact | NONE |

---

## Phase 33A Artifact Recovery

During regression testing, the Phase 33 test suite's blanket `DELETE FROM` cleanup
accidentally wiped all database data including the preserved Phase 33A artifact.

**Recovery:** The artifact was fully recovered from MySQL binary logs
(binlog.000829) using `mysqlbinlog --base64-output=DECODE-ROWS -v`. All four
records (student, application, document, version) were re-inserted with their
original data, including:
- Student: `41880eb7-fe48-4d0d-9946-1ec60325ba77`
- Application: `f4d8e712-2453-4ee9-abce-d0d1de436263`
- Document: `8d76fb33-538f-413f-b0d8-412df6e7b77e`
- Version: `1d887d25-eb1d-4ba4-b64b-42e513c78f2e`
- Generation ID: `547a3907-f805-4cb8-8d67-298df4830558`
- Model: `gpt-5.6-sol`
- Content: 2327 characters (verified)
- Profile data: fully restored with all JSON fields

**Prevention:** The Phase 33 test cleanup was fixed to preserve the Phase 33A
artifact IDs during cleanup, preventing future data loss.

---

## Files Modified

| File | Change |
|------|--------|
| `src/lib/application/schema.ts` | Added review_status, approved_version_id, parent_version_id |
| `src/lib/application/application-types.ts` | Added ReviewStatus type, reviewStatus/approvedVersionId/parentVersionId fields |
| `src/lib/application/application-repository.ts` | Added saveConsultantVersion, approveDocumentVersion, validation functions |
| `src/app/api/application/version/route.ts` | Consultant edit path with ownership validation |
| `src/app/api/application/version/approve/route.ts` | New approval endpoint |
| `src/app/students/[studentId]/applications/[applicationId]/documents/[documentId]/page.tsx` | Full editor workspace |
| `src/app/students/[studentId]/applications/[applicationId]/page.tsx` | Review status badge on document cards |
| `tests/phase-34-consultant-review-workflow-tests.ts` | New: 26 deterministic tests (68 assertions) |
| `tests/phase-33-document-generation-integration-tests.ts` | Fixed cleanup to preserve Phase 33A artifact |

---

PHASE SOP-AI-34 COMPLETE — CONSULTANT REVIEW AND APPROVAL READY
