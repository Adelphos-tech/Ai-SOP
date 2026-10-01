# USER-JOURNEY ACCEPTANCE MATRIX

Zero-token end-to-end scenarios. Evidence: `tests/resilience-acceptance.test.ts` (9/9 passing), CV import suites, and code audit of routes/UI.

Columns: St=create student · App=create application · CV=import/ignore CV · Int=complete intake · Doc=add document · Pre=preflight · Gen=expected generation state · RD=review/download.

| # | Scenario | St | App | CV | Int | Doc | Pre | Gen | RD |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Fresher + normal DOCX + SOP | ✅ | ✅ | ✅ PARSED/WARNINGS | ✅ full | ✅ | PASS | COMPLETED | ✅ PREVIEW always; FINAL after approve |
| 2 | Experienced + PDF + SOP | ✅ | ✅ | ✅ PARSED | ✅ full | ✅ | PASS | COMPLETED | ✅ |
| 3 | Healthcare + table DOCX + Personal Statement | ✅ | ✅ | ✅ PARSED_WITH_WARNINGS | ✅ | ✅ | PASS | COMPLETED(+warn) | ✅ |
| 4 | Research + academic CV + Stmt of Academic Purpose | ✅ | ✅ | ✅ publications honored | ✅ | ✅ | PASS | COMPLETED | ✅ |
| 5 | Career switcher + sparse resume + Essay | ✅ | ✅ | ⚠️ EXTRACTION_ONLY (text preserved for review) | ✅ partial | ✅ | PASS w/ warnings | COMPLETED_WITH_WARNINGS | ✅ |
| 6 | Scanned resume + Visa SOP | ✅ | ✅ | ✅ OCR fallback (PARSED_WITH_WARNINGS, review banner) | ⚠️ needs visa evidence | ✅ | **BLOCK** until visa evidence entered (intentional #5) → then PASS | COMPLETED | ✅ |
| 7 | Image-only DOCX + Custom document | ✅ | ✅ | ✅ OCR_TEXT_EXTRACTION | ✅ | ✅ | PASS | COMPLETED | ✅ |
| 8 | No CV + manual intake | ✅ | ✅ | ➖ skipped | ✅ manual | ✅ (post-fix: no longer gated) | PASS after minimum facts | COMPLETED | ✅ |
| 9 | No official prompt + consultant prompt | ✅ | ✅ | n/a | ✅ | ✅ custom prompt accepted on all types | PASS | COMPLETED | ✅ |
| 10 | Same student + 3 applications | ✅ | ✅ | ✅ shared facts reusable | per-app context isolated | ✅ | per-app | independent | ✅ |
| 11 | One application + 5 documents | ✅ | ✅ | ✅ | ✅ | ✅ prompts/limits/topics isolated per doc | per-doc | independent runs/versions | ✅ |
| 12 | Partial CV + manual corrections | ✅ | ✅ | ⚠️ PARTIAL_PARSE | ✅ edit/save intake | ✅ | PASS | COMPLETED | ✅ |

## Key gates (intentional)

- **Row 6** is the only content gate that blocks: Visa SOP requires visa-specific evidence (return-home plans, country questionnaire, or career goals). Verified live: `careerGoals.longTerm.vision` via `context_data` unblocks.
- **Row 5**: sparse CV does NOT hard-fail — EXTRACTION_ONLY keeps extracted text visible for review; consultant proceeds via manual intake.
- Server-side `GENERATION_BLOCKED` returns structured reasons with links — not dead ends.

## Verified isolation (prior + this audit)

- Application context stored in `applications.context_data`; `resolveApplicationContext` strips app-scope keys from shared profile — cross-application contamination impossible on v2 apps (27/27 scope tests).
- Per-document requirements live in `application_documents`; 5-doc isolation verified in test 8.
