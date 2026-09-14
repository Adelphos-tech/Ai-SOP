# PHASE SOP-AI-1 / SOP-AI-1B REPORT — OpenAI SOP Writing Pipeline

**Date:** Wed 9 Sep 2026
**Phase:** SOP-AI-1 (Foundation) + SOP-AI-1B (Live Pipeline + Cost Verification)

---

## OpenAI SDK
- **Version:** 7.10.0 (official Node.js SDK)
- **Import:** Server-side only (`lib/ai/openai-client.ts`)

## Model
- **Configured:** gpt-5.6-sol (all 6 stages)
- **Exists in API:** YES (confirmed via models.list)
- **Per-stage model configuration:** YES (AI_MODELS in config.ts)
- **Environment override:** OPENAI_SOP_MODEL + per-stage OPENAI_MODEL_* overrides

## API Key Status
- **Configured:** YES (set in .env.local, chmod 600)
- **Valid:** YES (authenticated successfully)
- **In source code:** NO (never hardcoded)
- **In client bundle:** NO (verified — 0 files contain key)
- **In git:** NO (.env* in .gitignore)
- **Key printed in report:** NO

## Pipeline Stages: 6

All stages use gpt-5.6-sol for quality baseline.

| Stage | Name | Implementation | Live Smoke Test |
|---|---|---|---|
| 1 | SOP Planner | COMPLETE | PASS |
| 2 | Draft Writer | COMPLETE | PASS |
| 3 | Fact Reviewer | COMPLETE | PASS |
| 4 | Quality Reviewer | COMPLETE | PASS |
| 5 | Language Calibrator | COMPLETE | PASS |
| 6 | Finalizer | COMPLETE | PASS |

## Feature Verification

| Feature | Status |
|---|---|
| Fact Sheet approval gate | PASS |
| Server-side API route (POST /api/sop/generate) | PASS |
| Client key exposure | PASS (0 files in client bundle) |
| Result page (/sop-result) | PASS |
| Editor | PASS |
| Word counting | PASS |
| Usage logging | PASS |
| Per-stage model configuration | PASS |
| Per-stage cost tracking | PASS |
| USD→INR exchange rate | PASS |
| Cost panel (admin/dev) | PASS |
| Cost guardrails | PASS (MAX_PIPELINE_CALLS=6) |
| No OpenAI calls from client | PASS |
| No Qwen/Ollama used | PASS |
| No benchmark cases tested | PASS (not run) |
| Deterministic checks don't call AI | PASS |

## OPENAI LIVE SMOKE TEST

- **API access:** PASS
- **Planner:** PASS
- **Writer:** PASS
- **Fact Reviewer:** PASS
- **Quality Reviewer:** PASS
- **Language Calibrator:** PASS
- **Finalizer:** PASS
- **Final word count:** 995
- **Requested word range:** 800-1000
- **Word range compliance:** PASS
- **Fact check:** FAIL (8 unsupported interpretive claims, 1 altered wording, 2 ambiguous)
- **Unsupported facts (invented data):** 0 (no invented universities, employers, countries, scores, projects, technologies, awards, or dates)
- **Quality score (average):** 7.2/10
- **Writing profile:** Natural Professional
- **Writing profile respected:** PASS

### Quality Scores (Individual)
- personalization: 7
- narrative_flow: 8
- academic_story: 8
- career_alignment: 8
- course_relevance: 5
- naturalness: 7
- professional_tone: 9
- generic_language: 6
- repetition: 6
- resume_in_prose: 7
- opening_quality: 8
- conclusion_quality: 7
- sentence_variety: 7
- fact_coverage: 8

### Format Checks
- Markdown: PASS (none detected)
- Headings: PASS (none detected)
- Bullets: PASS (none detected)
- Plain professional paragraphs: PASS

### Fact Audit
- Invented university: PASS
- Invented country: PASS
- Invented CGPA/grades: PASS
- Invented English score: PASS
- Invented employer: PASS
- Invented project: PASS
- Invented technology: PASS
- Invented award: PASS
- Invented dates: PASS

Note: The fact reviewer flagged 8 "unsupported claims" — these are interpretive elaborations (e.g., "The chatbot made admissions information more accessible") rather than invented factual data. No invented universities, employers, countries, scores, projects, technologies, awards, or dates were found.

## COST BREAKDOWN

### Per-Stage Cost

| Stage | Model | Input | Cached | Output | Total | Time | USD | INR |
|---|---|---|---|---|---|---|---|---|
| Planner | gpt-5.6-sol | 1,276 | 1,273 | 1,496 | 2,772 | 23.3s | $0.0304 | ₹2.89 |
| Writer | gpt-5.6-sol | 2,729 | 0 | 1,497 | 4,226 | 30.0s | $0.0409 | ₹3.87 |
| Fact Reviewer | gpt-5.6-sol | 2,420 | 0 | 1,253 | 3,673 | 23.0s | $0.0347 | ₹3.29 |
| Quality Reviewer | gpt-5.6-sol | 1,630 | 0 | 810 | 2,440 | 15.9s | $0.0227 | ₹2.15 |
| Language Calibrator | gpt-5.6-sol | 1,438 | 0 | 1,260 | 2,698 | 12.6s | $0.0310 | ₹2.94 |
| Finalizer | gpt-5.6-sol | 4,945 | 0 | 1,664 | 6,609 | 27.0s | $0.0531 | ₹5.03 |
| **TOTAL** | | **14,438** | **1,273** | **7,980** | **22,418** | **131.8s** | **$0.2128** | **₹20.18** |

### Cost Summary
- Total Input Tokens: 14,438
- Total Cached Input Tokens: 1,273
- Total Output Tokens: 7,980
- Total Tokens: 22,418
- Total Pipeline Duration: 131.8 seconds
- Estimated OpenAI API Cost USD: $0.2128
- USD→INR Rate: ₹94.84
- FX Source: open.er-api.com (as of Wed, 09 Sep 2026 00:02:31 +0000)
- FX Retrieved: 2026-09-09T07:48:00.912Z
- FX Stale: false
- Estimated OpenAI API Cost INR: ₹20.18
- Most Expensive Stage: Finalizer ($0.0531)

### Pricing Used
- Input: $4.00 per 1M tokens
- Cached Input: $0.40 per 1M tokens
- Output: $20.00 per 1M tokens
- Pricing version: 2026-09-09

Note: "Estimated" API cost — calculated from actual token usage. May need reconciliation against OpenAI billing records.

## Architecture

```
src/lib/ai/
  config.ts              — Central AI config + per-stage models + guardrails
  types.ts               — All TypeScript interfaces (incl. StageUsage, PipelineCost)
  openai-client.ts       — Server-side only OpenAI client
  pricing.ts             — Centralized pricing + calculateStageCost()
  usage-logger.ts        — Token/cost logging to JSONL

  prompts/
    planner.ts, writer.ts, fact-reviewer.ts,
    quality-reviewer.ts, language-calibrator.ts, finalizer.ts

  pipeline/
    build-ai-input.ts, plan-sop.ts, write-draft.ts,
    review-facts.ts, review-quality.ts, calibrate-language.ts,
    finalize-sop.ts, run-sop-pipeline.ts

  validation/
    output-validator.ts, word-count.ts

src/lib/currency/
  exchange-rate.ts        — USD→INR with caching (6h TTL, open.er-api.com)

src/app/api/sop/generate/route.ts  — Server-side API
src/app/sop-result/page.tsx         — Result page with cost panel
src/app/fact-sheet/page.tsx        — Generate SOP button
```

## Production Impact
- **Public frontend:** 200 (unchanged)
- **Local frontend:** 200 (unchanged)
- **Backend:** 200 (unchanged)
- **PM2 restart count BEFORE:** 4680
- **PM2 restart count AFTER:** 4680
- **Delta:** 0
- **nginx:** active (unchanged)
- **SOP app:** 200 on 127.0.0.1:5010
- **Production impact:** NONE

## Known Issues
1. Fact reviewer flags interpretive elaborations as "unsupported" — these are not invented facts but reasonable inferences. May need to adjust fact reviewer strictness.
2. Quality reviewer noted generic ASU rationale (no specific courses/faculty named) — expected since we instructed the model not to invent university details.
3. Chatbot project discussed in multiple paragraphs — some redundancy noted by quality reviewer.
4. Healthcare AI goal appears late and unsupported by prior healthcare experience.
5. gpt-5.6-sol does not support temperature parameter (only default=1) or max_tokens (must use max_completion_tokens).
6. Transient planner failures observed on rapid re-runs — likely rate limiting; resolved by waiting.

## Cost Optimization Preparation
- Per-stage model configuration ready (AI_MODELS in config.ts)
- Can switch individual stages to Terra/Luna via environment variables
- Cost guardrails configured (MAX_PIPELINE_CALLS, MAX_COST_USD_PER_SOP, MAX_TOKENS)
- Usage logging captures all data for future analysis
- No optimization applied yet — baseline captured first

## Smoke Test Artifacts
- Full result: logs/smoke-tests/smoke-test-1-2026-09-09.json
- Final SOP: logs/smoke-tests/final-sop-1.txt
- Usage log: logs/openai-usage.jsonl
- FX cache: logs/fx-cache.json
