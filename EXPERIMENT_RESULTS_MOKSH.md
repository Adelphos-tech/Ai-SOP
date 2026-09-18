# Experiment Results — Moksh SOP (generation 9584eb02)

Date: 2026-09-17
Baseline: `9584eb02` — 6 stages all `gpt-5.6-sol`, 725w, **$0.6245 / ₹59.97**
Harness: `tests/experiment-replay.ts` — replays the exact pipelineInput from prod data, no DB writes. Artifacts: `/tmp/sop-exp/logs/attempts/<uuid>/` on server (ephemeral).
Fact safety held in every completed run: **0 invented, 0 altered facts**.

## Results summary

| | BASELINE | A: compact reviews | B: writer narrative | C: prompt caching | D: terra QR/LC/Fin |
|--|----------|--------------------|--------------------|-------------------|--------------------|
| **Cost** | $0.6245 / ₹59.97 | **$0.5758 / ₹55.28 (−7.8%)** | **$0.5528 / ₹53.08 (−11.5%)** | FAILED at stage 3 | **$0.5868 / ₹56.35 (−6.0%)** |
| Input tokens | 33,000 | 32,713 | 30,920 | 20,366 (partial) | 32,845 |
| Cached tokens | 0 | 0 | 4,318 | 0 | 6,080 |
| Output tokens | 24,625 | 22,245 | 22,231 | 6,568 (partial) | 23,867 |
| Words | 725 | 757 | 713 | — | 828 |
| FR verdict | pass | pass (8 interp) | pass (10 interp) | n/a | pass (6 interp) |

## Experiment A — Compact QR + FR outputs

Env: `EXPERIMENT_COMPACT_REVIEWS=1` — terse `reason` fields (≤10 words, "-" for SUPPORTED), feedback caps, ID list caps. Schema unchanged.

| Stage | Out tokens (base→A) | Cost (base→A) |
|-------|--------------------| --------------|
| qualityReviewer | 6,885 → **4,980 (−28%)** | $0.1722 → $0.1344 |
| factReviewer | 5,500 → **5,064 (−8%)** | $0.1289 → $0.1203 |

Also cut QR reasoning 1,011→404 and FR 1,740→1,121. FR is already claim-echo-bound — limited headroom. **No safety loss** (0 invented/altered). Verdict: **keep** — free ~4% savings.

## Experiment B — Writer narrative rules

Env: `EXPERIMENT_WRITER_NARRATIVE=1` — anti-enumeration, ≤3 tools/paragraph, ≤3-spine experiences, required genuine reflection, thematic ordering, repetition cap.

**Quality — measurably better:**

| Metric | BASELINE | B |
|--------|----------|---|
| Paragraphs | 11 | **8** |
| Commas (enumeration proxy) | 115 | **63 (−45%)** |
| "scalab*" | 5 | **1** |
| "reliab*" | 6 | 3 |
| "production*" | 5 | 2 |
| "deploy*" | 10 | 8 |

The skills-list paragraph and AWS service enumeration are gone; the middle now carries a thematic arc (research → production AI → cloud) with reflection sentences that state changed thinking, not formulaic closers. Writer reasoning rose 1,383→3,072 (harder compositional work) but total cost still fell 11.5% (QR/FR outputs were shorter).

Verdict: **adopt** — fixes the #1 quality problem at the source with a cost reduction.

## Experiment C — Prompt caching — FAILED

`setExperimentSharedPrefix()` prepended an identical 28.5KB (~7,100 tok) block to all six system prompts.

- Stage inputs ballooned (planner 3,164→8,824; writer 5,446→11,542).
- **qualityReviewer returned empty content** — input ~14k tokens drove reasoning to exhaust the 8,000-token completion budget. Pipeline failed at stage 3 after $0.213 spend.
- **cached=0 on all calls** — the giant shared prefix produced no cross-stage cache hits.

Separately observed in B/D runs: **OpenAI auto-caching already works** — the planner hit 3,161/3,164 cached tokens because its input was byte-identical to the prior run's (cache TTL). So the platform caches exact-prefix repeats; the failed approach was forcing a giant synthetic prefix.

Correct mechanism for a future attempt: keep the *natural* shared leading content (safety block + facts) in the same position but modest (<1,500 tok), and rely on OpenAI's automatic prefix caching for identical stage inputs on retries/checkpoint resumes — not on a synthetic mega-prefix.

Verdict: **rejected as implemented.** Caching already helps retries/duplicate-stage inputs; a synthetic prefix is net-negative (bigger inputs, completion-budget risk).

## Experiment D — Terra for QR / Calibrator / Finalizer

Env: `OPENAI_MODEL_QUALITY_REVIEWER/LANGUAGE_CALIBRATOR/FINALIZER=gpt-5.6-terra` (models confirmed available on the account).

- All three terra stages produced valid structured output; pipeline completed; FR passed.
- Output quality comparable to baseline (still slightly resume-like — terra didn't fix enumeration, as expected; that's B's job).
- Measured cost **−6.0%** — but this is priced at *sol placeholder rates* ($4/$20 per 1M). **Real delta depends on actual terra pricing** — update `MODEL_PRICING["gpt-5.6-terra"]` (currently a placeholder) and re-score. If terra ≈ ½ sol price, QR+LC+Fin stages (≈52% of baseline cost) would yield ~26% total savings.
- Terra QR reasoning 449 vs sol 1,011; finalizer reasoning 0 vs 572 — terra reasons less; quality held.

Verdict: **viable candidate** — pending real terra pricing confirmation.

## Recommendation

| Action | Expected effect | Risk |
|--------|----------------|------|
| **Adopt B** (narrative rules) | −11.5% cost + fixes resume-in-prose at source | Low — prompt text only |
| **Adopt A** (compact reviews) | additional ~4% | Low — schema unchanged |
| **Confirm terra pricing, then adopt D** for QR/LC/Fin | −6% at sol rates; potentially −25%+ if terra is cheaper | Medium — needs pricing confirmation + a quality spot-check across document types |
| Reject C as built | — | prefix approach is harmful |

**Stacked estimate (A+B+D):** ~₹45–50 per SOP (−17–25%), with better narrative quality than baseline.

No changes made to production paths — all experiment toggles are env-gated (`EXPERIMENT_*` unset in prod). New files: `tests/experiment-replay.ts`; toggles in `prompt-safety-block.ts`, `generic/writer.ts`, `generic/quality-reviewer.ts`, `generic/final-fact-reviewer.ts`.
