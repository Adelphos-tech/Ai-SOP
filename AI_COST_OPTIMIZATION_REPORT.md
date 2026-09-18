# AI COST OPTIMIZATION REPORT — Compact Reviewer Outputs

Baseline: run `269ed9e8` (COMPLETED, all 6 stages) — $0.65 / ₹62.84, ~6.1 min.
All figures below are **OFFLINE ESTIMATES** from stored production
artifacts — no OpenAI calls, no document generations.

## 1. Consumer-first field audit

Fields produced by model output but consumed by zero downstream code
(static search over pipeline, action-planner, evidence-suitability,
validators, routes, UI):

| Field | Stage | Consumed by | Verdict |
|---|---|---|---|
| componentScores[].feedback | QR | nothing | removed (optional) |
| overall_feedback | QR | nothing | removed (optional) |
| majorIssues | QR | nothing (planner derives missing topics) | removed (optional) |
| recommendedEdits | QR | nothing | removed (optional) |
| factualRiskClaims[].claimType | QR | nothing (writer already owns claim types) | removed (optional) |
| candidateEvidence[].reason | QR | nothing | removed (optional) |
| candidateEvidence[].requiredContext | QR | nothing | removed (optional) |
| SUPPORTED claims in factualRiskClaims | QR | nothing (planner filters only non-SUPPORTED) | → verifiedClaimIds |
| supportingSourceIds | FR | nothing | removed (optional) |
| components[].inventedCount/alteredCount/elaborationCount/ambiguousCount | FR | overwritten by deriveFactReviewTotals | removed (optional) |
| totalInventedFacts/Altered/Elaborations/Ambiguous | FR | derived server-side | removed (optional) |
| claimMap[].rewrittenText (unchanged claims) | LC | verbatim fallback added | omittable |

Fields preserved (safety-critical): claimIds, claim text for
non-SUPPORTED claims, evidenceId+suitability+supportedContext,
factualRiskClaims status/reason/expansion flags, topicCoverage
(topic+covered), requirementCompliance, FR claim text (audit trail),
supportingFactIds, severity, overallPass, blockingReason,
calibrated text, claimMap (rewritten claims).

## 2. Replay measurement (stored artifacts, run 269ed9e8)

| Stage | Serialized chars | Est. tokens | Compact chars | Est. tokens | Reduction |
|---|---|---|---|---|---|
| Quality Reviewer | 19,435 | ~4,470 | 1,209 | ~278 | **-94%** |
| Fact Reviewer | 16,604 | ~3,820 | 10,701 | ~2,460 | **-36%** |
| Language Calibrator | 14,987 | ~3,445 | 13,342 | ~3,067 | **-11%** |

QR reduction is extreme because this document's 38 claims were all
SUPPORTED — previously each restated claim text + 7 fields. Now
SUPPORTED claims emit as `verifiedClaimIds` (IDs only). Runs with
real risks will still emit full non-SUPPORTED claim entries.

LC reduction modest: this run rewrote all 38 claims, so the
verbatim-omit path saved nothing; savings came from schema trimming.

## 3. Estimated totals (offline estimate only)

| Stage | Current output tok | Est. compact output tok |
|---|---|---|
| Planner | 1,738 | 1,738 (unchanged) |
| Writer | 8,731 | 8,731 (unchanged) |
| Quality Reviewer | 6,721 | ~2,530 (278 visible + ~2,251 reasoning) |
| Language Calibrator | 3,074 | ~3,160 |
| Finalizer | 1,425 | 1,425 (unchanged) |
| Fact Reviewer | 5,775 | ~4,530 (2,460 + ~2,065 reasoning) |
| **Total** | **27,464** | **~22,100** |

Reasoning tokens held constant (conservative — likely lower in
practice). **Estimated output reduction: ~20%.** Projected cost
~$0.52–0.56 / ₹47–50 per SOP vs $0.65 / ₹62.84 — **OFFLINE
ESTIMATE**, not measured savings.

## 4. Safety regression matrix

- Requirement checking: PASS (topicCoverage/requirementCompliance unchanged)
- Claim provenance: PASS (verifiedClaimIds + full non-SUPPORTED entries)
- Invented claim detection: PASS (INVENTED_FACT → deriveTotals → fail)
- Altered claim detection: PASS
- Interpretive handling: PASS (INTERPRETIVE_ELABORATION counted)
- Finalizer action planning: PASS (planComponentActions byte-identical
  on full vs compact — test QR3/QR4)
- Final fact overallPass: PASS (deterministic derive)
- Document length: UNCHANGED (no prompt/length rule touched)
- Six-stage architecture: UNCHANGED
- Writer contract: UNCHANGED
- Token ceilings: UNCHANGED (16k/8k)
- Models / reasoning effort: UNCHANGED

## 5. Field removal report

| Field | Why generated | Downstream usage | Safety dep | Removed |
|---|---|---|---|---|
| QR feedback | prose assessment | none | none | YES (optional) |
| QR overall_feedback | prose summary | none | none | YES (optional) |
| QR majorIssues | advisory list | none — planner derives from topicCoverage | none | YES (optional) |
| QR recommendedEdits | advisory list | none | none | YES (optional) |
| QR factualRiskClaims[].claimType | writer claim type echo | none (writer owns types) | none | YES (optional) |
| QR candidateEvidence[].reason | diagnostic | none | none | YES (optional) |
| QR candidateEvidence[].requiredContext | diagnostic | none | none | YES (optional) |
| QR SUPPORTED claim entries | audit completeness | planner consumes only non-SUPPORTED | provenance → verifiedClaimIds | YES (→IDs) |
| FR supportingSourceIds | dual provenance | none | none | YES (optional) |
| FR per-component counts | convenience | derived server-side | none | YES (optional) |
| FR model totals | convenience | derived server-side | none | YES (optional) |
| LC rewrittenText on unchanged claims | provenance | consumer fallback to writer text | claim preservation still validated | YES (omittable) |

## 6. What shipped

- Compact QR prompt contract (machine actions; SUPPORTED→verifiedClaimIds;
  no advisory prose; bounded reason fields)
- Compact FR prompt contract (verification metadata only; no
  sourceIds/counts/totals)
- LC claimMap: rewrittenText omittable when verbatim + consumer
  fallback (extracted buildCalibratedClaims, exported + tested)
- Validators: removed fields optional (backward compatible with any
  stored full-shape outputs)
- Verbosity warnings: REVIEWER_OUTPUT_VERBOSE >4000,
  FACT_REVIEW_OUTPUT_VERBOSE >3500, LANGUAGE_OUTPUT_VERBOSE >2500
  output tokens (internal logs, non-blocking)
- Utilization fields already on UsageLogEntry (maxOutputTokens,
  visibleOutputTokens, utilizationRatio)

## 7. Tests

15/15 compact-contract tests + 68/68 transport + 38/38 lifecycle.
OpenAI calls: 0. Document generations: 0.
