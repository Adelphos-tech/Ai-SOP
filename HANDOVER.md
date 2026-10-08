# HANDOVER — D-Vivid Consultant Application Writing Platform

## Project Overview

Consultant-controlled platform that writes university application documents (SOPs, essays, personal statements) with a 6-stage AI pipeline. All AI calls are server-side. Documents are evidence-constrained to faculty-approved student facts with claim provenance tracking and factual-safety validation.

**Production:** https://sop.adelphostech.com/
**Repo:** https://github.com/Adelphos-tech/Ai-SOP.git (branch: `main`)
**Local dev:** `/Users/shivang/Desktop/AI SOP/deploy/server-12b/`

**Latest:** Phase 5 verification complete — no code changes required. Production commit `309f949` deployed and verified 2026-10-08. UI/UX redesign program COMPLETE.

## Stack

- Next.js 14.2.5 (App Router), React 18.3.1, TypeScript 5.5.3
- MySQL 8 (mysql2), Tailwind CSS 3.4.6
- OpenAI SDK 7.10.0, Model: `gpt-5.6-sol` (per-stage configurable via env)
- Puppeteer (headless Chromium) for PDF page validation during generation
- pdf-lib + docx for exports
- PM2 process manager, nginx reverse proxy, GitHub Actions CI/CD

## Production Server

- Host: `root@156.67.105.64` (SSH)
- App dir: `/opt/sop-ai-app/`
- PM2 name: `sop-app` — runs `npm start` → `next start -p 5010 -H 127.0.0.1`
- Port 5010 bound to localhost; nginx proxies 443 → 127.0.0.1:5010
- 6 CPU cores (AMD EPYC), 16 GB RAM, no cgroup CPU limits
- MySQL on same host (127.0.0.1:3306); Redis present but unused by this app
- CV files stored OUTSIDE deployment tree: `/opt/sop-ai-data/cv`
- CV parser sidecar: internal `http://127.0.0.1:8099` (Docling + RapidOCR)
- Deployed release ID file: `/opt/sop-ai-app/.ci-release-id`

Health check:
```bash
ssh root@156.67.105.64 'pm2 jlist'  # find sop-app status/unstable_restarts
curl -s -o /dev/null -w "HTTP %{http_code}" https://sop.adelphostech.com/
curl -s http://127.0.0.1:5010/api/metrics   # server-side only (401 externally)
```

## CI/CD

`.github/workflows/deploy.yml` — on push to `main`:
1. Install deps → run tests (MySQL 8 service container) → build → SSH deploy → health check → auto-rollback on failure.
- Scripts: `scripts/ci-deploy.sh`, `scripts/ci-rollback.sh`
- Secrets used: `SOP_TEST_DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, plus SSH keys
- Deploy takes ~4 min. Verify with `gh run list --branch main --limit 1`.

## Canonical Consultant Workflow

```
/students → New Applicant (/students/new) → creates student + first application
  → Application Workspace (/students/{sid}/applications/{aid})
  → CV upload (pre-fills profile) and/or 9-section intake
  → Add Document → Document Workspace → Generate → Review → Approve → Export
```

- Application Workspace shows ONE state-based primary CTA: Complete Missing Information → Add Document → Generate → Review → Export.
- `/app-setup` redirects to `/students/new`. Legacy profile routes are redirects.
- Login is BYPASSED — `requireConsultantSession()` returns a dummy ADMIN (see below).

## 9-Section Canonical Intake

`src/app/students/[studentId]/applications/[applicationId]/intake/[step]/page.tsx`

Sections: Student Details/Education, Field Motivation, Academics & Projects, Work Experience, Master's Motivation, Country Questions, Subject Requirements, University Requirements, Career Goals. This is the ONLY writable profile flow.

## AI Pipeline (6 stages, DO NOT MODIFY without care)

`src/lib/ai/pipeline/run-application-pipeline.ts`
1. Planner → 2. Writer → 3. Quality Reviewer → 4. Language Calibrator → 5. Bounded Finalizer → 6. Final Fact Reviewer

Data flow:
```
persisted profile → loadDocumentGenerationContext() → adaptProfile()
→ generation contract studentFacts → buildApplicationEvidenceBundle()
→ buildEvidenceLedger() → pipeline stages → deterministic render validation
```

Key files:
- `src/lib/application/profile-adapter.ts` — canonical→pipeline field mapping (has legacy fallbacks; canonical fields authoritative)
- `src/lib/ai/pipeline/build-ai-input.ts`, `evidence-ledger.ts`, `application-evidence-bundle.ts`
- `src/lib/requirements/planner-relevance.ts`, `generation-contract.ts`
- `src/lib/application/generation-service.ts` — entry point, calls adaptProfile()
- Render validation: `src/lib/render/{renderer,pre-final-render,final-render}.ts`
- Export: `src/lib/application/document-export.ts`

**Model:** `gpt-5.6-sol` (default), per-stage override via `OPENAI_MODEL_<STAGE>` env vars. Configured in `src/lib/ai/config.ts`.

## CPU / Concurrency Hardening

`src/lib/concurrency/resource-limiter.ts` — in-process semaphore + bounded queue. `ResourceBusyError` → HTTP 503 with codes `RENDER_BUSY`, `EXPORT_BUSY`, `CRAWL_BUSY`, `CV_PARSE_BUSY`. resolve-prompt degrades gracefully to default template.

Env vars (defaults shown):
```
MAX_CONCURRENT_RENDERS=2    MAX_QUEUED_RENDERS=3    # Puppeteer — measured safe
MAX_CONCURRENT_EXPORTS=3    MAX_QUEUED_EXPORTS=5
MAX_CONCURRENT_CRAWLS=2     MAX_QUEUED_CRAWLS=3
MAX_CONCURRENT_CV_PARSE=2   MAX_QUEUED_CV_PARSE=3
METRICS_API_KEY=<optional>  # enables external /api/metrics access
```

Measured on prod: render concurrency 2 → load 64% (safe); 3 → 90%; 4 → 120% oversaturated. Full data in `CPU_RESOURCE_AUDIT.md`.

`/api/metrics` auth: allows localhost/private IPs, or `X-Metrics-Key` header matching `METRICS_API_KEY`. Externally returns 401.

## CV Parser (Multi-Strategy, Resilient)

**NOT "NO OCR"** — resilient multi-strategy pipeline:

1. **Legacy rule-based** (`cv-parser.ts`): pdf-parse + mammoth text extraction + pattern matching
2. **Docling semantic** (`cv-mapper-docling.ts`): Docling sidecar → structured blocks → section-aware mapping
3. **Docling sidecar** (`docling-client.ts`): internal `http://127.0.0.1:8099` — `/parse`, `/ocr`, `/inspect`, `/health`
4. **RapidOCR local fallback** (`ocrWithService`): free local OCR for image-only/scanned files
5. **Mammoth** (`extractTextFromDOCX`): DOCX text extraction with zip-bomb protection
6. **pdf-parse** (`extractTextFromPDF`): text-based PDF extraction (v1/v2 API compatible)
7. **Image inspection** (`inspectPdfWithService`): detects image-dominant PDFs before silent data loss

**Supports:**
- Text-based PDF (pdf-parse)
- Scanned/image-only PDF (RapidOCR via sidecar)
- DOCX (Mammoth)
- Mixed text/image DOCX (Mammoth + semantic mapping)
- Mixed text/image PDF (Docling + OCR fallback)
- No paid parser, no AI/LLM CV parsing, no external SaaS

**Engine selection:** `CV_PARSER_ENGINE=legacy|docling` (default: legacy). Docling requires sidecar on port 8099.

Key files:
- `src/lib/application/cv-parser.ts` — legacy rule-based parser
- `src/lib/application/cv-mapper-docling.ts` — Docling semantic mapper
- `src/lib/application/docling-client.ts` — sidecar client
- `src/lib/application/cv-sanity.ts` — candidate sanitization/dedupe

## Generation Reliability (Completed)

- **Checkpoint persistence** (`pipeline-checkpoint.ts`): per-stage output saved with prompt version hash
- **Provider response reuse** (`openai-transport.ts`): deduplication key by prompt hash + model + params
- **No-repay behavior**: identical prompt → cached response, no second provider call
- **RECOVERING state** (`generation-recovery.ts`): interrupted run resumes from last successful checkpoint
- **Generation ownership** (`generation-ownership.ts`): single-writer lock per document
- **active_generation_run_id** (`generation-registry.ts`): authoritative current run
- **attempt_seq strict ordering** (`generation-ordering.ts`): monotonic sequence, no reordering
- **Race protection**: per-document lock + attempt sequence
- **Migration-safe schema** (`generation-schema.ts`): versioned contracts, assertion checks
- **Durable observability** (`generation-lifecycle.ts`): structured logs, metrics, error codes
- **Terminal UI reconciliation** (`generation-ui-terminal.test.ts`): completed run never leaves page stuck

## Application / Document Scoping (Critical)

**STUDENT** = reusable facts only (personal, education, experience, skills, projects, certifications, achievements)

**APPLICATION** = application-scoped context (country questionnaire, master's motivation, career goals, field motivation, subject requirements, university/application requirements)

**DOCUMENT** = exact prompt/instructions/limits/topics/questions/formatting per document type

The 9-section intake is the ONLY writable flow, and it is scoped per application. Student profile is NOT edited directly — it is prefilled from CV import and then edited inside an application workspace.

## Known Gaps / Important Notes

- **Auth bypassed:** `src/lib/auth/consultant-session.ts` line ~252 — `requireConsultantSession()` returns hardcoded dummy. Uncomment real check + remove bypass to enable login.
- **PM2 single process** — limiters are process-local; cluster mode needs shared-state redesign first.
- Discovery is sequential + DISCOVERY_BUDGET-capped; resolve-prompt falls back to default template on failure.
- Generation lock is per-document (`acquireGenerationLock` in application-repository.ts), not global.
- sop-app PM2 restart counter ~350 (historical, `unstable_restarts: 0` — fine).

## Tests / Verification

- `tests/cpu-benchmark.ts` — PDF export + Puppeteer render benchmark (`npx tsx tests/cpu-benchmark.ts`)
- `tests/queue-full-test.ts` — verifies ResourceBusyError on all 4 limiters (`npx tsx tests/queue-full-test.ts`)
- `tests/evidence-mapping-test.ts` — canonical→pipeline field mapping test (no OpenAI)
- `tests/student-workspace-ui.test.ts` — Student Workspace UI tests (`npx tsx tests/student-workspace-ui.test.ts`)
- `tests/generation-ui-terminal.test.ts` — terminal state regression (`npx tsx tests/generation-ui-terminal.test.ts`)
- `scripts/phase-*-test.js` — various phase acceptance tests
- Build: `npx next build`; Lint: `npm run lint`

## Environment Variables

See `.env.example`: `OPENAI_API_KEY`, `OPENAI_SOP_MODEL=gpt-5.6-sol`, `SOP_DB_*` (prod + test), `SOP_CV_STORAGE`, `SOP_AUTH_SECRET`, `SOP_SESSION_SECRET`, `NEXT_PUBLIC_BUILD_ID`, plus the `MAX_CONCURRENT_*` limiter vars, `METRICS_API_KEY`, `CV_PARSER_ENGINE`, `CV_PARSER_SERVICE_URL`.

## Phase Status

- **Phase 1**: COMPLETE — Workspace redesign foundation (sidebar, students worklist, error layer)
- **Phase 2**: COMPLETE — Student workspace redesign (tab-based, visual polish, mobile search)
- **Phase 3**: COMPLETE — Application workspace + Add Application redesign
- **Phase 4**: COMPLETE + DEPLOYED — Intake wizard, Add Document workflow, Document Studio
- **Phase 5**: COMPLETE — Critical verification complete, NO code changes required

## Recent History (most recent first)

- `309f949` (2026-10-08) — Phase 5 verification: COMPLETED_WITH_WARNINGS visibility, mobile 390px, recovery UX — all PASS, no changes
- `fd9ae5c` (2026-10-05) — Phase 2 visual polish: official D-Vivid logo, mobile global search, enhanced Profile tab
- `b8d687e` (2026-10-02) — Phase 2: Student workspace redesign (tab-based, verified 2026-10-05)
- `aa2bace` — Phase 1: Workspace redesign foundation (sidebar, students worklist, error layer)
- `2841fdc` — Terminal-state reconciliation fix
- `7992fb2` — Production smoke execution results
- `53aa4f7` — CV upload resilience fix
- `4ea6fe8` — Generation ownership, app-context scope, CV resilience

## Quick Start for Next Engineer

```bash
cd "/Users/shivang/Desktop/AI SOP/deploy/server-12b"
git status && git log -3 --oneline
cp .env.example .env.local   # fill in values
npm run dev                  # localhost:5010
npm run build                # verify before pushing
git push origin main         # triggers CI deploy (~4 min)
gh run list --branch main --limit 1   # watch deploy
```
