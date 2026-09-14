# PHASE SOP-AI-34A: TEST ISOLATION AND DOCUMENT EXPORT

**Date:** 2026-09-11
**Status:** COMPLETE
**Phase Type:** Infrastructure + Product Workflow (NOT an AI phase)

---

## Summary

Closed the final two gaps before full manual consultant testing:

1. **Test Database Isolation**: All automated tests now run against an isolated
   `sop_ai_app_test` database with a dedicated `sop_test` user that has NO access
   to production data. A hard safety guard aborts tests immediately if connected
   to any non-test database.

2. **Document Export**: Consultants can export saved/approved document versions
   as PDF and DOCX. Preview export works on any saved version. Final export
   requires an approved version. Physical page limit validation uses actual
   rendered PDF page count.

No OpenAI calls were made. The six-stage AI pipeline remains frozen.

---

## PART A: TEST DATABASE ISOLATION

### Test Database

- **Database**: `sop_ai_app_test`
- **User**: `sop_test@127.0.0.1`
- **Access**: SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX, ALTER
  on `sop_ai_app_test` only
- **Production access**: NONE (verified: sop_test cannot access sop_ai_app,
  dvivid_db, or dvcourse)

### Hard Safety Guard

`tests/test-setup.ts` provides:
- `assertTestDatabase()`: Checks `SELECT DATABASE()` — throws immediately if
  not `sop_ai_app_test`
- `cleanupTestDb()`: Deletes all test data (only callable on test DB)
- `getProductionCounts()`: Read-only production count verification

All 7 DB-touching test files import from `./test-setup` as their FIRST import,
ensuring the test DB env vars are set before any pool is created.

### Production-ID Preservation Hack Removed

The Phase 33 test cleanup no longer preserves specific production artifact IDs.
Tests freely clean `sop_ai_app_test` without knowing or caring about production data.

### Isolation Verification

| Check | Result |
|-------|--------|
| Tests use sop_ai_app_test | PASS |
| Test runner rejects sop_ai_app | PASS |
| sop_test cannot access sop_ai_app | PASS |
| sop_test cannot access dvivid_db | PASS |
| sop_test cannot access dvcourse | PASS |
| Production counts unchanged after full regression | PASS (1/1/1/1 → 1/1/1/1) |

---

## PART B: DOCUMENT EXPORT

### Export API

**POST `/api/application/document/export`**

Input:
```json
{
  "studentId": "...",
  "applicationId": "...",
  "documentId": "...",
  "versionId": "...",
  "format": "PDF" | "DOCX",
  "mode": "PREVIEW" | "FINAL"
}
```

- Validates full ownership hierarchy: student → application → document → version
- PREVIEW: any saved version
- FINAL: requires `approvedVersionId`, versionId must match approved version
- Physical page limit validation for FINAL PDF export (actual rendered pages)
- Returns file as downloadable attachment

### PDF Generation

- Library: `pdf-lib` (already in dependencies)
- 12pt Helvetica, 1-inch margins, 1.5x line spacing
- Proper word wrapping, multi-page support
- Returns actual page count

### DOCX Generation

- Library: `docx` (newly added)
- 12pt Calibri, 1-inch margins, justified paragraphs
- 1.5x line spacing, 10pt after paragraph spacing
- Professional simple formatting

### Exported Content

Exports ONLY the document content. No internal metadata:
- No model name
- No generation ID
- No cost fields
- No AI stage info
- No hashes
- No version database IDs

### File Names

- Preview: `<StudentName>_<University>_<DocumentType>_DRAFT_V<version>.pdf`
- Final: `<StudentName>_<University>_<DocumentType>.pdf`
- Sanitized: unsafe filename characters removed

### UI

Document workspace now includes an Export section with:
- **Draft Preview**: Download Draft PDF, Download Draft DOCX
- **Final Export** (when approved): Download Final PDF, Download Final DOCX
- Clear separation between preview and final

---

## Test Results

### Phase 34A Tests (A-U)

```
tests/phase-34a-test-isolation-and-export-tests.ts
=== Results: 78 passed, 0 failed ===
```

| Test | Description | Result |
|------|-------------|--------|
| A | Automated tests use sop_ai_app_test | PASS |
| B | Test runner rejects sop_ai_app | PASS |
| C | Test account cannot access production sop_ai_app | PASS |
| D | Production row counts unchanged after regression suite | PASS |
| E | Preview PDF exports saved version | PASS |
| F | Preview DOCX exports saved version | PASS |
| G | Preview does not require approval | PASS |
| H | Draft filename contains DRAFT and version number | PASS |
| I | Final export blocked without approval | PASS |
| J | Final PDF exports approvedVersion | PASS |
| K | Final DOCX exports approvedVersion | PASS |
| L | Latest version does not override approved version | PASS |
| M | Cross-student export blocked | PASS |
| N | Cross-document export blocked | PASS |
| O | PDF is structurally valid | PASS |
| P | DOCX is structurally valid | PASS |
| Q | Multi-page PDF works | PASS |
| R | Internal AI metadata absent | PASS |
| S | Physical official pageLimit validated | PASS |
| T | Zero OpenAI calls | PASS |
| U | Six-stage AI pipeline unchanged | PASS |

### Regression Suites (all against sop_ai_app_test)

| Suite | Result |
|-------|--------|
| Phase 29 | 71/71 PASS |
| Phase 30 | 52/52 PASS |
| Phase 31 | 51/51 PASS |
| Phase 32 | 78/78 PASS |
| Phase 32B | 85/85 PASS |
| Phase 33 | 196/196 PASS |
| Phase 33B | 40/40 PASS |
| Phase 34 | 68/68 PASS |
| Phase 34A | 78/78 PASS |
| TypeScript | PASS |

### Build

```
rm -rf .next && npm run build
```
- Clean build: PASS
- `.next/prerender-manifest.json` generated naturally: PASS

---

## TEST ISOLATION

| Check | Result |
|-------|--------|
| Test DB | sop_ai_app_test |
| Tests can access production DB | NO |
| Production guard | PASS |
| Regression changed production rows | NO |

## PREVIEW EXPORT

| Check | Result |
|-------|--------|
| PDF | PASS |
| DOCX | PASS |
| Draft filenames | PASS |

## FINAL EXPORT

| Check | Result |
|-------|--------|
| Requires approval | YES |
| PDF | PASS |
| DOCX | PASS |
| Approved version exact | PASS |

## FILE VALIDITY

| Check | Result |
|-------|--------|
| PDF valid | PASS |
| DOCX valid | PASS |
| Multi-page | PASS |
| Internal metadata absent | PASS |

## AI

| Check | Result |
|-------|--------|
| OpenAI calls | 0 |
| AI pipeline modified | NO |

## PRODUCTION

| Check | Result |
|-------|--------|
| SOP backend (5010) | 200 |
| Frontend (5002) | 200 |
| Public frontend (https) | 200 |
| nginx | active |
| Unexpected PM2 delta | 0 |
| Production DB changed by tests | NO |

---

## Files Modified

| File | Change |
|------|--------|
| `tests/test-setup.ts` | New: Test DB isolation module with hard safety guard |
| `tests/phase-29-application-foundation-tests.ts` | Use test-setup, assertTestDatabase |
| `tests/phase-30-student-reuse-workspace-tests.ts` | Use test-setup, assertTestDatabase, cleanupTestDb |
| `tests/phase-31-production-persistence-tests.ts` | Use test-setup, assertTestDatabase, cleanupTestDb |
| `tests/phase-32-requirements-knowledge-base-tests.ts` | Use test-setup, assertTestDatabase, cleanupTestDb |
| `tests/phase-32b-prompt-resolution-flow-tests.ts` | Use test-setup, assertTestDatabase, cleanupTestDb |
| `tests/phase-33-document-generation-integration-tests.ts` | Use test-setup, removed prod-ID hack |
| `tests/phase-34-consultant-review-workflow-tests.ts` | Use test-setup, assertTestDatabase, cleanupTestDb |
| `tests/phase-34a-test-isolation-and-export-tests.ts` | New: 21 tests (78 assertions) |
| `src/lib/application/document-export.ts` | New: PDF/DOCX export utilities |
| `src/app/api/application/document/export/route.ts` | New: Export API endpoint |
| `src/app/students/[...]/page.tsx` | Export UI buttons (preview + final) |
| `src/lib/application/schema.ts` | Fixed: Added requirement_set_id, writing_requirement_id to CREATE TABLE |
| `src/lib/application/requirements-schema.ts` | Fixed: Commented out unsupported ALTER IF NOT EXISTS |
| `package.json` | Added: docx@9.5.1 |

---

PHASE SOP-AI-34A COMPLETE — SAFE TESTING AND DOCUMENT EXPORT READY
