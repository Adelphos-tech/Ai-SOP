# PHASE SOP-AI-2 — Five-Case OpenAI Sol Quality + Cost Benchmark

**Date:** Wed 9 Sep 2026
**Phase:** SOP-AI-2 — Five-Case OpenAI Sol Benchmark
**Model:** gpt-5.6-sol (all 6 stages)
**Pipeline:** 6-stage (Planner → Writer → Fact Reviewer → Quality Reviewer → Language Calibrator → Finalizer)

---

## Benchmark Results

| CASE | CATEGORY | WORDS | QUALITY | DURATION | INPUT TOKENS | CACHED TOKENS | OUTPUT TOKENS | COST USD | COST INR | INVENTED FACTS | INTERP. FLAGS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SOP-R001 | MS in Data Science | 1112 | 7.7 | 181.5s | 22,258 | 0 | 9,237 | $0.2738 | ₹25.97 | 0 | 17 |
| SOP-R002 | Master of Finance | 1186 | 8.1 | 174.0s | 17,374 | 0 | 8,595 | $0.2414 | ₹22.89 | 0 | 12 |
| SOP-R003 | Master of Construction Management | 1248 | 7.5 | 157.7s | 16,363 | 0 | 7,923 | $0.2239 | ₹21.24 | 0 | 6 |
| SOP-R004 | MS in Pharmaceutical Sciences | 1157 | 7.3 | 183.2s | 18,315 | 0 | 8,547 | $0.2442 | ₹23.16 | 0 | 4 |
| SOP-R005 | BS in Biotechnology | 1174 | 7.4 | 166.5s | 15,974 | 0 | 7,923 | $0.2224 | ₹21.09 | 0 | 7 |

## Quality Comparison: OpenAI vs Qwen

| CASE | QWEN SCORE | OPENAI PIPELINE SCORE | DELTA |
|---|---|---|---|
| SOP-R001 | 6.75 | 7.71 | +0.96 |
| SOP-R002 | 7.00 | 8.07 | +1.07 |
| SOP-R003 | 6.92 | 7.50 | +0.58 |
| SOP-R004 | 7.00 | 7.29 | +0.29 |
| SOP-R005 | 6.42 | 7.43 | +1.01 |

## Aggregate Metrics

- **OPENAI AVERAGE QUALITY:** 7.60
- **QWEN AVERAGE QUALITY:** 6.82
- **QUALITY DELTA:** +0.78

### Cost

- **AVERAGE SUCCESSFUL SOP COST USD:** $0.2411
- **AVERAGE SUCCESSFUL SOP COST INR:** ₹22.87
- **MEDIAN COST USD:** $0.2414
- **MEDIAN COST INR:** ₹22.89
- **MIN COST USD:** $0.2224
- **MIN COST INR:** ₹21.09
- **MAX COST USD:** $0.2738
- **MAX COST INR:** ₹25.97
- **TOTAL COST FOR 5 SUCCESSFUL SOPs:** $1.2056 / ₹114.35
- **TOTAL COST INCLUDING FAILED ATTEMPTS:** $1.2056 / ₹114.35 (failed attempts consumed 0 tokens)

### Tokens

- **AVERAGE INPUT TOKENS:** 18,057
- **AVERAGE CACHED INPUT TOKENS:** 0
- **AVERAGE OUTPUT TOKENS:** 8,445
- **TOTAL INPUT TOKENS:** 90,284
- **TOTAL CACHED TOKENS:** 0
- **TOTAL OUTPUT TOKENS:** 42,225
- **TOTAL TOKENS:** 132,509

### Duration

- **AVERAGE PIPELINE DURATION:** 172.6s (2 min 53s)
- **TOTAL PIPELINE DURATION:** 863.0s (14 min 23s)

### Stage Cost Analysis

- **MOST EXPENSIVE STAGE:** Finalizer (23.5% of total cost)
- **MOST EXPENSIVE STAGE SHARE:** 23.5%

| Stage | Avg Cost USD | Share % |
|---|---|---|
| Finalizer | $0.0566 | 23.5% |
| Writer | $0.0460 | 19.1% |
| Planner | $0.0413 | 17.1% |
| Language Calibrator | $0.0364 | 15.1% |
| Fact Reviewer | $0.0358 | 14.8% |
| Quality Reviewer | $0.0251 | 10.4% |

### Fact Audit

- **TOTAL INVENTED FACTS:** 0
- **TOTAL INTERPRETIVE ELABORATIONS:** 46
- **TOTAL ALTERED FACTS:** 2

### Format

- **STRICT_WORD_RANGE_PASS:** 0/5 (all cases exceeded 900-1100 default range)
- **TOLERANCE_WORD_RANGE_PASS (10%):** 4/5 (R003 at 1248 words exceeds 1210 tolerance)
- **FORMAT PASS:** 5/5 (no markdown in any case)

Note: The system default word range was 900-1100. All 5 generated SOPs exceeded this strict range (1112-1248 words). Tolerance compliance (10% over = 1210 max) passes for 4/5 cases. This does NOT represent official university requirement compliance — it represents compliance with the pipeline's system default. The Requirements Engine (PHASE SOP-REQ-1) will replace system defaults with verified official requirements.

## Retry Accounting

- **API Pipeline Attempts:** 7 (2 failed R001 + 5 successful)
- **Successful Pipeline Attempts:** 5
- **Failed Pipeline Attempts:** 2 (R001 planner returned empty content due to low max_completion_tokens; fixed by increasing to 4000)
- **Paid API Calls:** 30 (5 successful × 6 stages)
- **Successful API Calls:** 30
- **Failed API Calls:** 2 (0 tokens consumed)
- **Cost Successful Pipelines USD:** $1.2056
- **Cost All Attempts USD:** $1.2056
- **Cost All Attempts INR:** ₹114.35

## FX Rate

- **USD/INR Rate:** ₹94.84
- **FX Source:** open.er-api.com
- **FX Retrieved:** 2026-09-09T07:48:00.912Z
- **FX Stale:** false

## Reference Leakage

All 5 cases passed reference leakage checks. No human_written_sop, reference, provenance, or source_document_id keys were present in any pipeline payload.

## Per-Case Quality Scores

### SOP-R001 (MS in Data Science)
- personalization: 7, narrative_flow: 8, academic_story: 8, career_alignment: 8
- course_relevance: 5, naturalness: 7, professional_tone: 9, generic_language: 6
- repetition: 7, resume_in_prose: 7, opening_quality: 8, conclusion_quality: 7
- sentence_variety: 7, fact_coverage: 8
- Average: 7.7/10

### SOP-R002 (Master of Finance)
- personalization: 8, narrative_flow: 8, academic_story: 8, career_alignment: 8
- course_relevance: 7, naturalness: 8, professional_tone: 9, generic_language: 7
- repetition: 8, resume_in_prose: 8, opening_quality: 8, conclusion_quality: 8
- sentence_variety: 8, fact_coverage: 9
- Average: 8.1/10

### SOP-R003 (Master of Construction Management)
- personalization: 7, narrative_flow: 8, academic_story: 7, career_alignment: 8
- course_relevance: 6, naturalness: 8, professional_tone: 9, generic_language: 7
- repetition: 7, resume_in_prose: 7, opening_quality: 7, conclusion_quality: 7
- sentence_variety: 8, fact_coverage: 8
- Average: 7.5/10

### SOP-R004 (MS in Pharmaceutical Sciences)
- personalization: 7, narrative_flow: 7, academic_story: 7, career_alignment: 8
- course_relevance: 6, naturalness: 7, professional_tone: 9, generic_language: 7
- repetition: 7, resume_in_prose: 7, opening_quality: 7, conclusion_quality: 7
- sentence_variety: 7, fact_coverage: 8
- Average: 7.3/10

### SOP-R005 (BS in Biotechnology)
- personalization: 7, narrative_flow: 8, academic_story: 7, career_alignment: 8
- course_relevance: 6, naturalness: 8, professional_tone: 9, generic_language: 7
- repetition: 7, resume_in_prose: 7, opening_quality: 7, conclusion_quality: 7
- sentence_variety: 8, fact_coverage: 8
- Average: 7.4/10

## Key Findings

1. **Quality:** OpenAI pipeline averages 7.60/10 vs Qwen 6.82/10 — a +0.78 improvement. OpenAI is better in all 5 cases.
2. **Cost:** Average $0.2411/SOP (₹22.87). Total for 5 SOPs: $1.21 (₹114.35).
3. **Latency:** Average 172.6s per SOP (2 min 53s). Range: 157.7s–183.2s.
4. **Factual Integrity:** Zero invented facts across all 5 cases. 46 interpretive elaborations flagged (reasonable inferences, not fabrications). 2 altered facts.
5. **Format:** All 5 cases pass markdown/format checks. 4/5 pass word range (R003 slightly over at 1248 words).
6. **Most Expensive Stage:** Finalizer at 23.5% of total cost, followed by Writer at 19.1%.
7. **Cheapest Stage:** Quality Reviewer at 10.4% of total cost.
8. **No cached tokens** were used across any case (prompt caching not yet active for these prompts).
9. **Best case:** R002 (Finance) at 8.1/10 — strongest personalization and narrative.
10. **Weakest case:** R004 (Pharmaceutical) at 7.3/10 — weaker course relevance and academic story.

## Artifacts

- Per-case results: `logs/benchmarks/openai-sol/SOP-R00X-result.json`
- Per-case final SOPs: `logs/benchmarks/openai-sol/SOP-R00X-final.txt`
- Per-case usage: `logs/benchmarks/openai-sol/SOP-R00X-usage.json`
- Per-case evaluations: `logs/benchmarks/openai-sol/SOP-R00X-evaluation.json`
- Aggregate summary: `logs/benchmarks/openai-sol/baseline-summary.json`

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
