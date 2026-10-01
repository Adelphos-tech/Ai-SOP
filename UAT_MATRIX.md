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
