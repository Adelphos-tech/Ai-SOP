# PRODUCTION ERROR AUDIT

**Source:** `/root/.pm2/logs/sop-app-{out,error}.log` on
`sop.adelphostech.com` (current PM2 window — ~9 days; no rotation kept).
Grouped by error code. **Correction (Wave 0): the headline rate must
separate provider experiments.** 21 generation starts → 4 successes /
15 pipeline errors overall — but ≥5 of the 15 were Groq/Gemini
provider-testing failures (3× Groq 413 TPM, 2× Gemini 429), not the
production OpenAI path. **Production OpenAI-path failures: ~10** in
this window. Do not quote 71% as the normal OpenAI-path failure rate —
it conflates experiment runs with production traffic and the window is
too small for a rate anyway.

| ERROR CODE | COUNT | SUBSYSTEM | USER IMPACT | DATA LOSS | COST | RECOVERABLE | ROOT CAUSE |
|---|---|---|---|---|---|---|---|
| `CONTENT_JSON_INVALID` | 4 | AI generation (normalize) | generation fails | no | partial stages burned | yes (checkpoint resume) | **VERIFIED: all 4 were `gemini-2.5-flash` experiments** (planner×1, writer×2, languageCalibrator×1) — prose/fence-wrapped JSON; `extractJsonObject` recovery exists for this class. Zero on the OpenAI path |
| `413 TPM (Groq gpt-oss-120b)` | 3 | provider testing | generation fails | no | none (rejected pre-call) | yes | request exceeded Groq 8k TPM during provider experiments — not prod path |
| `429 quota (Gemini free tier)` | 2 | provider testing | generation fails | no | none | yes | free-tier 20 req/day during provider experiments — not prod path |
| `MISSING_REQUIRED_STUDENT_INFORMATION` | 2 | generation context | blocked w/ actionable msg | no | none | yes | intake incomplete — working as designed |
| `REQUIRED_TOPIC_COVERAGE_UNKNOWN` | 1 | generation gate | generation fails | no | partial | yes | mandatory-topic suitability indeterminate |
| `STAGE_ORDER_VIOLATION` | 1 | stage orchestration | generation fails | no | partial | yes | stage cursor raced (historical issue class) |
| `qualityReviewer contract violation` (`componentScores.0.wordCompliance: invalid_enum_value`) | 1 | quality reviewer schema | generation fails | no | partial | yes | **VERIFIED: `gemini-2.5-flash` experiment** — model emitted out-of-vocabulary enum; prompt ↔ Zod vocabulary confirmed consistent (now derived from shared constants) |
| `STAGE_TIMEOUT:factReviewer` | 1 | fact reviewer | **8.2 min of paid stages → FAILED at last stage** | version not created | **~5 stages paid, 0 output** | yes — stage-6-only retry via `generation_stage_responses` reuse | **ROOT CAUSE: PROVIDER_SLOW** — OpenAI bg response `resp_00a3396b` produced only 1,183 output tokens (976 reasoning) in 309s before local 300s SLA cancelled it; verbosity correlation NOT causal for this run |
| `FACT_REVIEW_OUTPUT_VERBOSE` | 3 | fact reviewer | none yet (warning) | no | higher tokens | n/a | reviewer exceeds compact target — precedes timeouts |
| `LANGUAGE_OUTPUT_VERBOSE` | 2 | language calibrator | none yet (warning) | no | higher tokens | n/a | same class |
| `DOCLING_UNREADABLE` | 1 | CV parsing | CV upload rejected (400) | no | none | yes | 655KB DOCX — prod Docling produced no blocks (student "kushi test", then deleted) |
| `cv_parse_stale_meta_reparse` | 1 | CV dedup | none — re-parse forced | no | none | n/a | engine/mapper-version gate working as designed |
| `generation_lock_conflict` | 1 | generation lock | 2nd Generate click rejected | no | none (correct) | n/a | lock working as designed ✓ |
| `generation_context_failed: Student not found` | 1 | generation context | generation can't start | no | none | yes | deleted student — expected |
| `generation_service_resume` / `generation_recovery_start` | 1 each | checkpoint | recovery path exercised | no | saved stages | n/a | crash recovery working as designed ✓ |

## NOTABLE NON-ERROR EVENTS
- `student-delete` ×6 (tester cleanup: Shivang, Moksh, LockTest×2, Benchmark, "kushi test")
- `document-delete` ×1 (Visa SOP)
- `cv_apply identity conflict` ×1 (name mismatch guard fired — correct)
- `Failed to find Server Action` / `digest null` Next errors (stale-deployment client artifacts — benign)
- `sharp` optional-dep warning (image optimization only — benign)

## PATTERNS
1. **Fact/language reviewer verbosity warnings precede the stage timeout** — the timeout is the escalation of a known verbose-output trend.
2. **Every hard failure after stage 1 leaves paid work at risk** — mitigated today only by `generation_stage_responses` fingerprint reuse; a fingerprint drift repays everything.
3. **CV failures give coarse codes** — `DOCLING_UNREADABLE` hides whether the cause is empty extraction, corrupt docx, or layout-only images.
4. **No log rotation** — historical error counting is impossible beyond the current PM2 window; earlier KNOWN bugs (stage-order/cursor) already rotated away.
