# Generation Cost + Quality Audit — Moksh SOP

Date: 2026-09-17
Generation: `9584eb02-ba21-4248-98fd-13a268212815`
- studentId: `45e4a41d-9940-4dc8-8b59-22683a0efb9c`
- applicationId: `140fe367-52a7-45df-9033-65065891b168`
- documentId: `f34415b0-c22e-4a2d-b801-16bf184c60f9`
- versionId: `fbffcf58-9828-46ed-a408-86418fcc499a` (V1)
- Model: `gpt-5.6-sol` (all 6 stages), run mode `CONTENT_REGENERATION`
- Duration: 18:21:50 → 18:26:26 UTC (~4m 36s)
- Source: `logs/attempts/9584eb02…/attempts.jsonl` + `accounting.json` + stage artifacts

## Per-call telemetry (single attempt per stage, zero retries)

| Stage | Calls | Input | Cached | Output | Reasoning | Latency | Cost | % Total |
|-------|-------|-------|--------|--------|-----------|---------|------|---------|
| planner | 1 | 3,164 | 0 | 1,221 | 177 | 21.7s | $0.0371 | 5.9% |
| writer | 1 | 5,446 | 0 | 5,884 | 1,383 | 64.2s | $0.1395 | 22.3% |
| qualityReviewer | 1 | 8,625 | 0 | 6,885 | 1,011 | 81.7s | $0.1722 | 27.6% |
| languageCalibrator | 1 | 5,390 | 0 | 3,190 | 120 | 32.4s | $0.0854 | 13.7% |
| finalizer | 1 | 5,643 | 0 | 1,945 | 572 | 21.3s | $0.0615 | 9.8% |
| factReviewer | 1 | 4,732 | 0 | 5,500 | 1,740 | 53.5s | $0.1289 | 20.6% |

Response IDs: planner `chatcmpl-EPB20Y72…`, writer `…EPB2L1aA…`, qualityReviewer `…EPB3NEFL…`, languageCalibrator `…EPB4hGgd…`, finalizer `…EPB5DYra…`, factReviewer `…EPB5Yl6w…`.

**Totals:** calls 6 · input 33,000 · cached 0 · output 24,625 · reasoning 5,003 · retries 0 · wall 274.6s.

## Cost reconciliation

Pricing (`src/lib/ai/pricing.ts`): $4.00/1M input, $0.40/1M cached input, $20.00/1M output. Per-stage math verifies exactly (e.g. planner 3,164×$4 + 1,221×$20 = $0.037076).

```
CALCULATED COST: $0.624500 (₹59.97 @ ~96.06/USD, stored exchange rate)
STORED COST:     $0.624500 / ₹59.97 (document_versions.cost_usd / cost_inr)
COST DIFFERENCE: $0.00 — accounting.json reports COMPLETE, 0 unknown-usage calls
```

## Cache audit

`cachedInputTokens = 0` on **all six calls**. The shared material (safety block, student facts/evidence ledger, generation contract) is resent to every stage but is not positioned as a cacheable prefix, or calls were spaced such that no prefix reuse occurred. **Caching is effectively not functioning** — not merely enabled-but-low.

Potential: if ~2,500–3,500 tokens of shared prefix per stage (planner excluded or included) were cached at $0.40/1M instead of $4.00/1M, savings ≈ 5 stages × ~3,000 × $3.60/1M ≈ **$0.054/generation (~9%)**, growing with fact-ledger size.

## Prompt-size / duplicated-context audit

Input token progression shows context accumulation:

- planner 3,164 — facts + prompt + contract only
- writer 5,446 — + planner output, writing instructions
- qualityReviewer **8,625** — largest: draft (855w ≈ 1,100 tok) + rubric + evidence ledger + requirements all resent
- languageCalibrator 5,390 — draft + language profile
- finalizer 5,643 — calibrated text + review output + contract
- factReviewer 4,732 — final text + evidence ledger + claim map

Student facts/evidence are resent to all 6 stages; requirements/prompt resent to ≥4. Quality Reviewer is the worst offender — its input exceeds even the Writer's despite producing no prose.

## Reasoning audit

| Stage | Reasoning tokens | % of output | Assessment |
|-------|-----------------|-------------|------------|
| planner | 177 | 14.5% | proportional |
| writer | 1,383 | 23.5% | justified (generative) |
| qualityReviewer | 1,011 | 14.7% | moderate — structured scoring task |
| languageCalibrator | 120 | 3.8% | low |
| finalizer | 572 | 29.4% | elevated for an edit-selection task |
| factReviewer | **1,740** | **31.6%** | highest — for claim classification |

Reasoning tokens are billed inside output tokens ($20/1M). factReviewer + finalizer reasoning = 2,312 tokens ≈ $0.046 (7.4% of total) — **lower-reasoning candidates** (structured tasks).

## Quality snapshots (stage transitions)

| Transition | Words | Change |
|------------|-------|--------|
| Writer draft | 855 | baseline |
| Calibrator | 853 | light personalization edits ("my curiosity", "taught me") |
| Finalizer | 722 | tightened ~15%, structure unchanged |
| Delivered | 715 | near-identical to finalizer |

- **Improved:** sentence tightening, minor voice injection by calibrator.
- **Worsened:** nothing materially degraded.
- **Not fixed:** resume-in-prose middle section, repetition, shallow reflection — all persisted through 3 rewrite stages.

Fact safety: **0 invented facts, 0 altered facts**, 5 interpretive elaborations, overallPass=true. Safety pipeline is doing its job.

## SOP quality audit (final, 715 words)

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Narrative arc | Medium | Decent arc exists (curiosity→AI+cloud→MS rationale) but buried under enumeration |
| Personal voice | Weak | Almost no first-person specifics beyond "curiosity about data science" |
| Academic motivation | Medium | Present but generic |
| Technical credibility | Strong | Real metrics (50 resumes, 80% match, <30s), real stack |
| Reflection | Weak | Formulaic tail sentences ("strengthened my understanding", "deepened my exposure") — stated, not demonstrated |
| Transition quality | Medium | Chronological internship chain, not thematic |
| Career-goal clarity | Good | Clear ST/LT goals |
| Repetition | **Poor** | "scalab*" ×5, "deploy*" ×7, "reliab*" ×6, "production" ×5, "end-to-end" ×3 across 10 paragraphs |
| Resume-like writing | **Poor** | ¶2 = skills list (24 commas), ¶5 = AWS service list, ¶6 = module enumeration |
| Program fit | Weak | University = "General" — no program specifics possible (input-data issue, not pipeline fault) |
| Conclusion | Medium | Competent but generic |

**A. CV-to-prose origin: WRITER.** The skills enumeration (¶2, 23 commas) and per-experience equal-weight paragraphs exist in `raw-02-writer.txt`. Calibrator and Finalizer only compressed them — they did not restructure. Quality Reviewer *detected* it ("much of the middle reads as a chronological resume in prose") but the architecture has no repair loop back to Writer.

**B. Repetition:** introduced at Writer, preserved through Finalizer.

**C. Reflection ratio:** ~75% WHAT-I-DID / ~25% stated-reflection, and the reflection is template phrasing rather than insight.

**D. Experience selection:** 4 experiences + 2 projects get near-equal weight. Strongest story (per supplied facts): **TM Systems** (production local-LLM work under hardware constraints — matches the intended arc best), then **iBhavan AWS internship**, then **research internship (Bumbershoot)**. Feel DevOps largely duplicates iBhavan (Docker/K8s/production deployment) and could be a supporting clause, not a paragraph.

## Narrative target (recommended structure — no rewrite performed)

The supplied facts do support the preferred arc:

1. Early curiosity — higher-secondary data-science spark ✓ (in facts)
2. AI experimentation on constrained hardware — local LLMs at TM Systems ✓
3. Models alone insufficient — optimization/inference lesson ✓ (already in opening)
4. Cloud/infrastructure exposure — iBhavan AWS ✓
5. Production AI — TM Systems credit engine/resume analyzer ✓
6. Knowledge gap — "designed, optimized, deployed, scaled reliably" ✓
7. Master's as next step ✓
8. Career direction ✓

The gap is **ordering and emphasis**, not missing facts: reorder so the constrained-hardware AI experience drives the middle; compress Feel DevOps into the iBhavan cloud progression; make the research internship a single supporting sentence unless publication is verified (planner already flagged SF-PROJ-1 as unverified).

## Input-data quality issues surfaced by the pipeline itself

- `officialPrompt` = `"please go as per uni pormpts"` — a consultant-typed placeholder, not a real prompt. The document was created with `CONSULTANT_PROVIDED` source carrying placeholder text.
- Planner flagged malformed intake fields: `SF-PERSONAL.currentCountry` is not a valid country; ambiguous degree/institution mapping in `SF-EDU-0`; `SF-PROJ-1` unverified publication.
- University = "General" → program-fit section can only be generic.

## Cost decision matrix

| Stage | Verdict | Rationale |
|-------|---------|-----------|
| planner | **KEEP SOL** | cheapest stage; structural planning benefits from strong model |
| writer | **KEEP SOL** | quality-critical generative work |
| qualityReviewer | **TEST TERRA** + context reduction | structured scoring/eval dominates; largest input (8,625) with no prose output |
| languageCalibrator | TEST TERRA candidate | stylistic pass; lowest reasoning use (120) suggests headroom |
| finalizer | **LOWER REASONING** + NO-OP/SKIP candidate when action=FREEZE | 572 reasoning tokens on an edit-selection task; a FREEZE action needs no model call |
| factReviewer | **LOWER REASONING** / TEST TERRA | 1,740 reasoning tokens (31.6% of output) for claim classification |
| ALL | **CACHE OPTIMIZATION** | 0/33,000 input tokens cached; shared prefix reordering is the single largest structural saving |

```
TOTAL MODEL CALLS:           6
TOTAL INPUT TOKENS:          33,000
TOTAL CACHED INPUT TOKENS:   0
TOTAL OUTPUT TOKENS:         24,625
TOTAL REASONING TOKENS:      5,003
TOTAL RETRIES:               0
CALCULATED COST:             $0.6245 / ₹59.97
STORED COST:                 $0.6245 / ₹59.97
COST DIFFERENCE:             $0.00

STAGE COST RANKING:
1. qualityReviewer  $0.1722 (27.6%)
2. writer           $0.1395 (22.3%)
3. factReviewer     $0.1289 (20.6%)
4. languageCalibrator $0.0854 (13.7%)
5. finalizer        $0.0615 (9.8%)
6. planner          $0.0371 (5.9%)

MOST EXPENSIVE STAGE: qualityReviewer
WHY: largest input (8,625 tok — draft + full evidence + rubric resent)
     + second-largest output (6,885 tok claim-by-claim review JSON)

BIGGEST QUALITY PROBLEM: resume-in-prose middle section + formulaic
reflection + word repetition (scalability/deployment/reliability loops)
WHERE INTRODUCED: Writer — detected by Quality Reviewer, unrepaired
(no Writer→rewrite loop in architecture)

BIGGEST COST-SAVING OPPORTUNITY: prompt-prefix caching — shared
facts/contract/safety prefix across all 6 calls currently caches 0
tokens; est. ~9%+ immediate savings, more as evidence ledgers grow
EXPECTED RISK: LOW (input reordering, no quality impact)

NO MODEL/PROMPT CHANGES MADE: YES
```

MOKSH GENERATION COST AND QUALITY AUDIT COMPLETE
