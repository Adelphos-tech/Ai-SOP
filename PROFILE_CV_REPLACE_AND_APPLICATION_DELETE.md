# PROFILE CV REPLACE + APPLICATION DELETE

**Date:** 2026-09-20 · **OPENAI calls:** 0 · **Generations:** 0

---

## PHASE 1 — PROFILE AUDIT (student `65783a5e` "shivang singh")

Provenance via `id` prefix (`cv-*` = CV-import; UUID-style = manual UI append):

| Array | Total | CV_DERIVED | MANUAL | UNKNOWN |
|---|---|---|---|---|
| education | **29** | 29 | 0 | 0 |
| experience | 2 | 2 | 0 | 0 |
| projects | 17 | 17 | 0 | 0 |
| achievements | 0 | 0 | 0 | 0 |
| skills (strings, no ids) | 23 | likely CV | — | — |
| personalData | 6 fields | Kunj's values (no per-field provenance) | — | — |

`_revision` = 8. No other top-level keys.

**20+ education cards: PERSISTED_DATA — not a UI bug.** `GET /api/application/profile` returns all 29 rows → `reset(profile)` → `useFieldArray("education")` renders one card per real element. Education #21 is an actual persisted row.

**Current merge behavior confirmed:** scalars fill-empty; arrays append+dedupe; skills merge. Apply **never removes** prior `cv-*` rows → a correct new CV cannot repair a corrupted profile.

## PHASE 2 — IMPLEMENTATION

### A. CV apply modes (`cv-apply/route.ts`)

- **MERGE (default, unchanged):** fill-empty scalars, append+dedupe arrays.
- **REPLACE-PREVIOUS-IMPORT (`replaceCvDerived: true`):** strips items whose `id` starts with `cv-` from `education`/`experience`/`projects`/`achievements` **before** merging the new CV. Manual + unknown-provenance items are preserved unconditionally. `skills` arrays carry no per-item provenance → untouched. `personalData` stays fill-empty (scalars have no provenance; identity is guarded separately). Audit log line records studentId/consultant/removed count.
- **Identity guard retained:** `CV_IDENTITY_CONFLICT` 409 still fires before any merge; "Apply Anyway" carries the replace flag so the two-step flow composes correctly.

### B. CVUpload UI

- New prop `hasCvDerivedData` — intake page computes it live from RHF values (`getValues()` → any `cv-*` id in the four arrays).
- "Apply to Profile" = merge (default). "Replace previous CV-imported data" appears only when `cv-*` items exist → opens an amber confirmation panel explaining *"removes previous CV-imported entries while preserving manually entered information"* → explicit **Confirm replace**.
- Identity-conflict banner unchanged; Apply Anyway preserves the replace intent.

### C. Delete Application

**FK audit:** `application_documents → applications` and `document_versions → documents` have `ON DELETE CASCADE`. `generation_runs` and `generation_stage_responses` have **no FK** → deleted explicitly in dependency order inside one transaction. `application_requirement_sets`/`writing_requirements`/`requirement_sources`/`institutions`/`programs` are shared program-level library data — never touched. `students`/`profile_data` untouched by design.

- `deleteApplicationCascade()` (repository): row lock → stage responses (via run_id AND document_id) → generation runs → versions → documents → application. Single transaction; no orphans.
- `POST /api/application/delete` `{applicationId, studentId}` — authenticated, verifies `application.studentId === studentId` before `authorizeStudentAccess`; 404/403/500 typed responses; audit log line.
- Workspace UI: small "Delete application" link under the status badge → inline confirm ("permanently delete this application and its associated documents and generation history. The student's reusable profile will NOT be deleted.") → delete → `router.push(/students/{id})`.

## REMEDIATION PREVIEW — `65783a5e` (NOT executed)

```
WILL REMOVE (proven cv-* provenance — Kunj's CV):
  education[29], experience[2], projects[17]
WILL PRESERVE:
  nothing manual found — all 48 array items are cv-*;
  skills/personalData lack provenance → preserved by replace mode
WILL NOT TOUCH:
  applications(4), documents, versions, generation history,
  application metadata, student row
Manual remediation path: open intake → upload correct CV →
  "Replace previous CV-imported data" → confirm → edit Student
  Details to fix personalData (syncs students row atomically).
```

## REPORT

```
CURRENT EDUCATION ROWS: 29
PROVEN CV-DERIVED: 29 (+ experience 2, projects 17)
MANUAL: 0
UNKNOWN: 0

20+ EDUCATION CARDS CAUSED BY: PERSISTED_DATA

CV MERGE MODE: IMPLEMENTED YES (unchanged default)
CV REPLACE-PREVIOUS-IMPORT MODE: IMPLEMENTED YES
MANUAL DATA PRESERVED: YES (cv-* prefix only; unknown → preserve)
IDENTITY GUARD RETAINED: YES

CURRENT CORRUPTED PROFILE MODIFIED: NO (awaiting user action via UI)

DELETE APPLICATION: IMPLEMENTED YES
DELETE IS TRANSACTIONAL: YES (single conn transaction, explicit no-FK cleanup)
STUDENT PROFILE PRESERVED: YES
OTHER APPLICATIONS PRESERVED: YES
DEPENDENT APPLICATION DATA CLEANED: YES (gsr → runs → versions → docs → app)

OPENAI CALLS: 0
GENERATIONS: 0
```

PROFILE CV REPLACEMENT + APPLICATION DELETE READY FOR MANUAL VALIDATION
