# HANDOVER — D-Vivid Consultant Application Writing Platform

## Project Overview

Consultant-controlled platform that writes university application documents (SOPs, essays, personal statements) with a 6-stage AI pipeline. All AI calls are server-side. Documents are evidence-constrained to faculty-approved student facts with claim provenance tracking and factual-safety validation.

**Production:** https://sop.adelphostech.com/
**Repo:** https://github.com/Adelphos-tech/Ai-SOP.git (branch: `main`)
**Local dev:** `/Users/shivang/Desktop/AI SOP/deploy/server-12b/`

## Stack

- Next.js 14.2.5 (App Router), React 18, TypeScript 5.5
- MySQL 8 (mysql2), Tailwind CSS
- OpenAI API (gpt-4o via `OPENAI_SOP_MODEL`)
- Puppeteer (headless Chromium) for PDF page validation during generation
- pdf-lib + docx for exports, pdf-parse + mammoth for CV import
- PM2 process manager, nginx reverse proxy, GitHub Actions CI/CD

## Production Server

- Host: `root@156.67.105.64` (SSH)
- App dir: `/opt/sop-ai-app/`
- PM2 name: `sop-app` — runs `npm start` → `next start -p 5010 -H 127.0.0.1`
- Port 5010 bound to localhost; nginx proxies 443 → 127.0.0.1:5010
- 6 CPU cores (AMD EPYC), 16 GB RAM, no cgroup CPU limits
- MySQL on same host; Redis present but unused by this app
- CV files stored OUTSIDE deployment tree: `/opt/sop-ai-data/cv`
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

## Known Gaps / Important Notes

- **NO OCR.** `pdf-parse` only reads text-based PDFs; image-only/scanned PDFs parse to empty text. Re-benchmark CPU before adding Tesseract.
- **Auth bypassed:** `src/lib/auth/consultant-session.ts` line ~252 — `requireConsultantSession()` returns hardcoded dummy. Uncomment real check + remove bypass to enable login.
- **PM2 single process** — limiters are process-local; cluster mode needs shared-state redesign first.
- Discovery is sequential + DISCOVERY_BUDGET-capped; resolve-prompt falls back to default template on failure.
- Generation lock is per-document (`acquireGenerationLock` in application-repository.ts), not global.
- sop-app PM2 restart counter ~350 (historical, `unstable_restarts: 0` — fine).

## Tests / Verification

- `tests/cpu-benchmark.ts` — PDF export + Puppeteer render benchmark (`npx tsx tests/cpu-benchmark.ts`)
- `tests/queue-full-test.ts` — verifies ResourceBusyError on all 4 limiters (`npx tsx tests/queue-full-test.ts`)
- `tests/evidence-mapping-test.ts` — canonical→pipeline field mapping test (no OpenAI)
- `scripts/phase-*-test.js` — various phase acceptance tests
- Build: `npx next build`; Lint: `npm run lint`

## Environment Variables

See `.env.example`: `OPENAI_API_KEY`, `OPENAI_SOP_MODEL`, `SOP_DB_*` (prod + test), `SOP_CV_STORAGE`, `SOP_AUTH_SECRET`, `SOP_SESSION_SECRET`, `NEXT_PUBLIC_BUILD_ID`, plus the `MAX_CONCURRENT_*` limiter vars and `METRICS_API_KEY`.

## Recent History (most recent first)

- `a7cb9b3` — CPU hardening verification + production measurements
- `111be54` — metrics endpoint localhost/API-key protection
- `1b6b8e0` — controlled 503 busy responses, backpressure docs
- `dcf3eb3` — CPU resource audit doc + benchmark test
- `1121504` — concurrency limiters + /api/metrics
- `b76f1f3` — state-based CTA, student pagination, CV upload in workspace, /app-setup redirect, dead-end removal
- `049229c` — canonical profile fields → AI evidence mapping
- `d3b97e0` — canonical profile editing flow locked
- `6304971` — workflow tracker rebuild

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
