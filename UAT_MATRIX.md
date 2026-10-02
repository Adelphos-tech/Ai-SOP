# UAT MATRIX — D-Vivid Application Writer

Structured UAT cases for the consultant workflow
STUDENT → APPLICATION → CV/INTAKE → DOCUMENT → GENERATE → REVIEW → DOWNLOAD.

Use controlled test applicants only — no real client data unless authorized.
Record results per the RESULT FORMAT at the bottom; classify findings
P0–P3 (P0 = data loss / wrong context / duplicate paid generation /
corrupted state — only P0 justifies stopping the pass).

## Cases

| # | Profile | Country | Program | CV format | Doc type | Focus |
|---|---|---|---|---|---|---|
| 1 | Fresher | Germany | Master | normal DOCX | SOP | baseline flow |
| 2 | Experienced professional | USA | MS | normal PDF | SOP | baseline PDF |
| 3 | Healthcare (PharmD/nursing) | Canada | Diploma | table DOCX | Personal Statement | domain skills preserved |
| 4 | Research-heavy | UK | PhD | academic CV (publications) | Statement of Academic Purpose | research intake path |
| 5 | Career switcher | Australia | MBA | sparse DOCX | Essay | EXTRACTION_ONLY → manual fill |
| 6 | Study gap | Germany | Master | normal DOCX | SOP | gap handled, no forced fields |
| 7 | Repeat/similar degree | USA | MS→MS | normal DOCX | SOP | no linear-progression assumption |
| 8 | Weak academics | Ireland | Bachelor | normal DOCX | SOP | low CGPA not a blocker |
| 9 | Table-layout CV | Canada | Master | table DOCX | SOP | mammoth semantic wins |
| 10 | Two-column CV | USA | MS | two-col PDF | SOP | docling wins |
| 11 | Scanned resume | UK | Master | scanned PDF | Visa SOP | OCR + visa evidence gate |
| 12 | Image-only DOCX | USA | MS | image DOCX | SOP | OCR fallback |
| 13 | Mixed DOCX (text+page images) | Germany | Master | mixed DOCX | SOP | image-dominance trigger |
| 14 | Mixed PDF (text layer+page image) | USA | MS | mixed PDF | SOP | /inspect → OCR trigger |
| 15 | No CV — manual intake only | any | any | none | SOP | manual escape path |
| 16 | No official prompt discovered | any | any | any | SOP | consultant prompt / default template |
| 17 | Consultant-provided prompt | any | any | any | Custom | custom instructions honored |
| 18 | Same student × 3 applications (DE MBA, US MS, CA Diploma) | mixed | mixed | shared CV | SOP ×3 | app-context isolation |
| 19 | One application × 5 documents (SOP, Essay, Essay2, Visa SOP, Custom) | any | any | any | mixed | doc-requirement isolation |
| 20 | Partial CV + manual corrections | any | any | partial | SOP | review → manual edit → apply |
| 21 | CV A applied, then replaced by CV B | any | any | two CVs | SOP | replaceCvDerived: old CV skills/edu removed, manual kept |
| 22 | Visa SOP with no return-intent evidence | UAE | any | any | Visa SOP | intentional BLOCK + clear reason |
| 23 | LOR with no recommender | any | any | any | LOR | intentional BLOCK until recommender entered |
| 24 | Corrupt/unreadable file | any | any | corrupt | — | FAILED_FILE + manual path |
| 25 | Oversized/page-heavy scan | any | any | huge scan | SOP | OCR limit → safe failure |
| 26 | Generation interruption mid-run | any | any | any | SOP | RECOVERING → resume → COMPLETED |
| 27 | Incomplete intake → add document | any | any | any | any | doc creation unblocked (post-fix) |
| 28 | Incomplete intake → generate | any | any | any | SOP | advisory warnings; server gate decides |
| 29 | Warnings present → review/download | any | any | any | any | PREVIEW always; FINAL after approve |
| 30 | Re-upload same CV | any | any | same CV | SOP | dedupe — no doubled records |

## Result format (per case)

```
CASE_ID: <n>
APPLICANT_PROFILE_TYPE / COUNTRY / PROGRAM_TYPE / CV_FORMAT / DOCUMENT_TYPE
STUDENT_CREATED:      YES/NO
APPLICATION_CREATED:  YES/NO
CV_RESULT:            PARSED | PARSED_WITH_WARNINGS | PARTIAL_PARSE |
                      EXTRACTION_ONLY | FAILED_FILE | NOT_USED
OCR_USED:             YES/NO
INTAKE_COMPLETED:     FULL | PARTIAL
DOCUMENT_CREATED:     YES/NO
PREFLIGHT:            PASS | WARNING | BLOCK
GENERATION_RESULT:    COMPLETED | COMPLETED_WITH_WARNINGS | RECOVERING | FAILED
REVIEW_AVAILABLE:     YES/NO
DOWNLOAD_AVAILABLE:   YES/NO
CONTEXT_CORRECT:      YES/NO
FACTUAL_ISSUES:       <n>
BLOCKER:              NONE | <description>
ACTION_NEEDED:        NONE | <description>
SEVERITY:             — | P0 | P1 | P2 | P3
```

## Production smoke execution — 2026-10-01 (commit 53aa4f7)

Executed on production with controlled test applicant
`smoke-uat-002@example.invalid`. GENERATION_RESULT intentionally not
executed (paid provider calls require explicit approval); preflight,
parsing, isolation, and error paths verified live.

| Case | Executed portion | Result |
|---|---|---|
| 1 | student→app→context→SOP doc→CV upload (normal DOCX) | PASS — 200, 483 chars parsed |
| 9 | table DOCX upload | PASS — 200, 596 chars, 2 warnings |
| 10 | two-col PDF upload | PASS — 200, 620 chars |
| 11 | scanned PDF upload | PASS — 200, 637 chars (OCR path) |
| 12 | blank/image DOCX upload | PASS — clean 400 CV_EXTRACTION_EMPTY |
| 13 | mixed text/image DOCX | PASS — 200, 2082 chars (image-dominant → OCR won) |
| 14 | mixed text/image PDF | PASS — 200, 323 chars (/inspect → OCR) |
| 15 | manual intake, no CV | PASS — app context saved v2 |
| 18 | app-context isolation A vs B | PASS — A reads A marker, B reads B marker |
| 19 | 4 docs on one app, distinct prompts/limits | PASS — each resolves its own |
| 22 | Visa SOP evidence gate | covered by gate inventory |
| 23 | LOR no recommender → generate | PASS — 422 GENERATION_BLOCKED, no provider call |
| 24 | corrupt DOCX | PASS — clean 400 CV_FILE_INVALID |
| 27 | doc creation with incomplete intake | PASS — 200, unblocked |
| 28 | generate with incomplete intake | PASS — advisory; server gate authoritative |
| 26 | recovery path | PASS — generation-resilience suites in CI |
| remaining | full generation, review, download, replace-CV | NOT RUN — requires paid provider calls / consultant session |

Error-UX spot checks (all clean, no SQL/stack/Zod/provider leaks):
bogus generate → 404 "Application not found"; cv-upload no file →
400 "No file provided"; bad student ID → 400 INVALID_STUDENT_ID;
bad doc id → 404 "Document not found"; empty save → 400 field list.

P0: 0   P1: 0   P2: 0   P3: 0  (first pass, non-generation scope)
