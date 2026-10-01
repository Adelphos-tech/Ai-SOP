# SYSTEM ARCHITECTURE AUDIT

**Scope:** D-Vivid Application Writer (`server-12b`). 41,502 LOC TS/TSX,
33 API routes, Next.js 14.2.5 / React 18 / Node 22 / MySQL (`mysql2`,
custom repo — no ORM) / Zod 3 / OpenAI SDK 7 / Docling 2.129.0 sidecar.

**Status:** ESLint **not configured** (`next lint` prompts setup). 1
typecheck error in `scripts/affinda-benchmark/affinda-adapter.ts`.
Auth: `requireConsultantSession` bypassed (intentional — login disabled).

---

## SUBSYSTEM MAP

| SUBSYSTEM | FILES / ENTRY POINTS | DB TABLES | EXT DEPS | FAILURE MODES |
|---|---|---|---|---|
| AUTH | `lib/auth/consultant-session.ts`, `lib/auth/rate-limiter.ts`, `api/auth/*` | — | — | bypass active (intentional); rate limit = in-memory Map (process-local, resets on restart, breaks under multi-worker) |
| STUDENTS | `api/application/student`, `api/application/student/delete`, repo `application-repository.ts` | `students` | — | cascade delete transactional ✓ |
| APPLICATIONS | `api/application/{create,list,save,delete,profile}` | `applications` | — | transactional cascades ✓ |
| INTAKE | `app/students/[id]/applications/[id]/intake/[step]/page.tsx` (1,032 LOC) | `student_profiles` (JSON) | — | RHF+Zod OK |
| DOCUMENTS | `api/application/document{,/delete,/generate,/export,/generation-status,/generation/cancel}` | `application_documents`, `document_versions`, `generation_runs`, `generation_stage_responses` | — | lock = atomic conditional UPDATE w/ 10-min stale recovery (DB-level, multi-process safe ✓) |
| REQUIREMENTS | `lib/requirements/*` (resolver, discovery-pipeline 1,111 LOC, domain-verification, html/pdf-extractor, requirements-db, application-context-repository) | `requirements_*` | remote fetch | **catch→null/[] silent fallbacks** (resolver:145,187; requirements-db:29,56; discovery-ai:99,176; app-ctx-repo:60,104; search-provider:179) |
| CV UPLOAD | `api/application/cv-upload/route.ts` (315 LOC), `docx-validator.ts` | file storage `/opt/sop-ai-data/cv` + meta.json dedup | — | **empty-parse returns success:true** (no min-content guard) |
| CV PARSING | sidecar `services/cv-parser/{app,parser}.py` → `docling-client.ts` → `cv-mapper-docling.ts` (581 LOC) → `cv-sanity.ts` → `resume-candidate.schema.ts` | — | Docling 2.129.0 | **P0: section detection requires `section_header`/`title` blocks → table-DOCX returns empty; DOCX name gate `page===1` never fires; DOCLING_UNREADABLE seen on prod (655KB file)** |
| CV APPLY/MERGE | `api/application/cv-apply/route.ts` (371 LOC), `cv-merge.ts` | `student_profiles` | — | identity-conflict guard exists ✓ |
| AI GENERATION | `lib/ai/pipeline/run-application-pipeline.ts` (**1,588 LOC monolith**), `stage-execution.ts` (649), `openai-transport.ts` (578), `generation-service.ts` (525), `generation-lifecycle.ts` (459), `bounded-finalizer.ts` (531), `claim-provenance.ts` (473) | `generation_runs`, `generation_stage_responses` | OpenAI Responses API (background mode) | **15 pipeline errors vs 4 successes in current log window** |
| OPENAI TRANSPORT | `openai-transport.ts` | — | OpenAI SDK 7 | per-stage SLA (default 300s, writer 480s), HTTP timeout 30s, bg-responses, fingerprint-based response reuse, terminal-failure classification |
| CHECKPOINT/RESUME | `pipeline-checkpoint.ts`, `checkpoint-utilities.ts`, lifecycle `recordStageResponse`/`findReusableProviderResponse` | `generation_stage_responses` | — | **stage-retry reuse verified** — retries don't repay earlier stages ✓ |
| FACT REVIEWER | `prompts/generic/final-fact-reviewer.ts`, `model-output-types.ts` | — | OpenAI | **STAGE_TIMEOUT seen; output 4.5–5k tokens vs 3.5k compact target (FACT_REVIEW_OUTPUT_VERBOSE ×3, LANGUAGE_OUTPUT_VERBOSE ×2)** |
| PROMPT RESOLUTION | `generation-context.ts` (613 LOC) `resolveAndMergePrompt` | — | — | **`useLegacyRequirements===true` gate — any caller omitting flag silently gets new-doc behavior** |
| EXPORT | `document-export.ts` | — | pdf-lib, docx lib | mature libs ✓; exportLimiter in-process |
| RENDER VALIDATION | `lib/render/{renderer,pre-final-render,final-render}.ts` | — | **puppeteer (headless Chromium in-process!) + pdf-lib** | heavy: browser launch per render check; single-point resource |
| FILE STORAGE | `docx-validator.ts`, cv-upload route | filesystem `/opt/sop-ai-data/cv` | mammoth, pdf-parse | custom ZIP validation, magic bytes ✓; meta.json dedup engine+version gated ✓ |
| DATABASE | `application-repository.ts` (1,113 LOC), `requirements-repository.ts` (507) | MySQL | mysql2 | 7 transaction sites; raw SQL throughout |
| BACKGROUND/POLLING | generation-status route (2s client poll), bg-responses wait | — | — | client poll OK |
| UI FORMS | RHF + zodResolver (intake, Add Document, CV upload) | — | RHF 7.88, zod | OK — do not rewrite |
| VALIDATION | Zod canonical for AI contracts; API input partially validated | — | zod | **no Zod gate on cv-upload parsed output volume** |
| ERROR HANDLING | `logCVParseFailure` structured; pipeline typed errors (StageTimeoutError, GenerationTimeLimitError, ProviderTerminalError) | — | — | mixed: some raw provider messages leak into `error` field (413/429 strings) |
| LOGGING | JSON `console.log` events | — | — | structured ✓ but no retention/rotation strategy on prod |
| RATE LIMITING | `rate-limiter.ts` in-memory; `resource-limiter.ts` semaphores | — | — | **process-local only** |

---

## BASELINE

```
typecheck:  FAIL(1)  scripts/affinda-benchmark/affinda-adapter.ts:104
lint:       NOT CONFIGURED
build:      PASS (earlier this session)
tests:      17 files → 14 PASS / 3 FAIL
  FAIL phase-12b-runner-mock        → tsx CJS transform (top-level await) — runner issue
  FAIL resolved-requirements-display→ stale test contract (predates useLegacyRequirements flag)
  FAIL phase-17-clarification       → golden fixture drift (projectClarifications absent
                                      from generation-contract-approved.json)
Node local v22.18.0 / prod v22.22.2; Next 14.2.5 both; Docling 2.129.0 both.
```
