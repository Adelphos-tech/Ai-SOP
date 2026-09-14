# PHASE SOP-AI-15 — GOLDEN REGRESSION #004
# CLOSED-WORLD WRITER + FACT SAFETY + PHYSICAL PAGE COMPLIANCE

## APPLICATION

Golden Fixture: MIT CEE MEng Fall 2027
Pipeline: GENERIC
Generation: #004
Generation ID: caaa8f42-46a6-4050-bfd4-b3a20ad9da39
Model: gpt-5.6-sol
Architecture: Phase 14 Evidence-Constrained + Checkpointed

--------------------------------

## GATES

Requirements: PASS
AI Policy: PASS (AI_GENERATION_ALLOWED)
Student Data: PASS (Fact sheet approved, requirements confirmed)
Faculty: PASS (Buyukozturk: STUDENT_APPROVED, Carstensen: STUDENT_APPROVED)
Generation Contract: PASS (CLEARED, clearedForWriting)

--------------------------------

## WRITER

Evidence packets: PASS (2 packets built, per-component)
Evidence validation: PASS (all usedEvidenceIds authorized)
Unauthorized evidence references: 0

Writer structured provenance:
  RC-MIT-CEE-A: 2 usedEvidenceIds, 9 factualClaims
  RC-MIT-CEE-B: 6 usedEvidenceIds, 17 factualClaims

--------------------------------

## PRE-FINAL FACT RISK

Quality Reviewer factualRiskClaims:
  Component A: 9 claims
    Supported: 5
    Potentially unsupported: 3
    Ambiguous: 1
  Component B: 13 claims
    Supported: 10
    Potentially unsupported: 1
    Ambiguous: 2
  Total:
    Supported: 15
    Potentially unsupported: 4
    Ambiguous: 3

Topic coverage (from Quality Reviewer):
  Component A: 4/5 covered (unforeseen challenges: NOT covered)
  Component B: 3/3 covered

--------------------------------

## COMPONENT A

Action: COMPRESS
Factual cleanup: NO (no factualCleanup directive — Quality Reviewer flagged risk but Action Planner did not receive the factualRiskClaims in its input shape)

Pre-final words: 203 (Writer) → calibrated
Final words: 166
Overflow ratio: N/A (1/1 pages, no overflow)
Pre-final pages: 1/1
Final pages: 1/1 PASS
Quality: 6/10

--------------------------------

## COMPONENT B

Action: COMPRESS
Factual cleanup: NO

Pre-final words: 386 (Writer) → calibrated
Final words: 257
Overflow ratio: N/A (1/1 pages, no overflow)
Pre-final pages: 1/1
Final pages: 1/1 PASS
Quality: 8/10

--------------------------------

## FINALIZER GUARD

valid: true (no violations, guard passed)
Violations: none

Note: The Finalizer guard validates scope, length, page, and evidence constraints. It does NOT perform semantic fact checking (that is stage 6). The guard passed because the Finalizer's output was structurally valid.

--------------------------------

## FINAL FACT SAFETY

Stage 6 Final Fact Reviewer (gpt-5.6-sol, max_completion_tokens=8000):

Supported student: 21
Supported program: 0
Supported faculty: 2
Interpretive: 16
Altered: 0
Invented: 1
Ambiguous: 0

Invented fact:
  Claim: "An unforeseen challenge was limited access to advanced engineering software."
  Component: RC-MIT-CEE-A
  Severity: BLOCKING
  Classification: INVENTED_FACT

Root causes:
  Writer: 0
  Language Calibrator: 0
  Finalizer: 1
  Unknown: 0

Analysis: The Writer correctly OMITTED this claim (the Planner noted it was unconfirmed). The Language Calibrator did not introduce it. The Finalizer introduced it during COMPRESS — likely attempting to address the "unforeseen challenges" topic that Quality Reviewer marked as not covered. The Finalizer added a factual claim that was not in the evidence packet.

This is a significant improvement: #003 had 4 Writer-introduced invented facts. #004 has 0 Writer-introduced and 1 Finalizer-introduced. The closed-world Writer constraint is working. The remaining issue is Finalizer factual discipline during compression.

--------------------------------

## SUBMISSION

Status: REVIEW_REQUIRED

Blockers:
  1. INVENTED_FACT (1): "An unforeseen challenge was limited access to advanced engineering software." — introduced by Finalizer in RC-MIT-CEE-A

Page compliance: PASS (A=1/1, B=1/1, Combined=2/2)

--------------------------------

## COST

Content attempts: 1 (successful)
Pipeline runs: 2 (1 failed at Writer due to code bug, 1 successful)
Technical retries: 0
Paid API calls: 8 (2 failed attempt + 6 successful run)

Per-stage usage (successful run):
  planner:             in=  1371 cached= 1368 out=  2756 total=  4127 cost=$0.055679 dur=49764ms
  writer:              in=  6218 cached=     0 out=  3337 total=  9555 cost=$0.091612 dur=50344ms
  qualityReviewer:     in=  5755 cached=     0 out=  4906 total= 10661 cost=$0.121140 dur=92021ms
  languageCalibrator:  in=  2438 cached=     0 out=   854 total=  3292 cost=$0.026832 dur=11871ms
  finalizer:           in=  3173 cached=     0 out=  1712 total=  4885 cost=$0.046932 dur=33507ms
  factReviewer:        in=  2439 cached=     0 out=  4890 total=  7329 cost=$0.107556 dur=65253ms

Input: 21394
Cached: 1368
Output: 18455
Total: 39849
Duration: 303.4s

Successful run USD: $0.449751
Technical retry USD: $0.000000
Failed attempt USD: $0.052279 (planner only — writer returned invalid content)
All-attempt USD: $0.502030
All-attempt INR: ₹47.76
USD/INR: 95.121034

Note: The first pipeline run failed at the Writer stage because the Planner returned factsToUse as descriptive text (not evidence IDs), which were incorrectly mapped as primaryEvidenceIds, producing empty evidence packets. This was fixed by validating that evidence IDs look like actual ledger IDs before using them. The second run completed all 6 stages successfully. The failed attempt cost $0.052 (planner call only; writer call returned invalid content at $0.019 but was retried as a content failure, not a technical retry).

--------------------------------

## COMPARISON

#001: Invented (not tracked), A 2p, B 2p, Quality (not tracked), Cost $0.274
#002: Invented 6, Altered 0, A 2p, B 2p, Quality 6.5, Cost $0.334, Status REVIEW_REQUIRED
#003: Invented 4, Altered 0, A 1p, B 2p, Interpretive 20, Cost $0.328, Status REVIEW_REQUIRED
#004: Invented 1, Altered 0, A 1p, B 1p, Interpretive 16, Cost $0.450, Status REVIEW_REQUIRED

Key improvements #003 → #004:
  Invented facts: 4 → 1 (−75%)
  Writer-introduced: 4 → 0 (−100%)
  Component B pages: 2 → 1 (PASS)
  Combined pages: 3 → 2 (PASS)
  Page compliance: FAIL → PASS

Remaining issue:
  Finalizer-introduced: 0 → 1 (Finalizer added unconfirmed claim during compression)

--------------------------------

## PRODUCTION

Frontend PM2 before: 4680
Frontend PM2 after: 4680
Delta: 0

SOP app: online (restarts: 1, unchanged)
nginx: active
All endpoints: 200
  https://www.dvividconsultant.com → 200
  http://127.0.0.1:5002 → 200
  https://api.dvividconsultant.com/api/blog/getAllTopBlogs → 200
  http://127.0.0.1:5010 → 200

Production impact: NONE

Historical #001/#002/#003: all SHA-256 hashes unchanged

--------------------------------

## ARTIFACTS

Saved to: logs/live-generations/mit-cee-meng-fall-2027-004/
  generation-contract.json
  gate-result.json
  planner.json
  writer.json
  quality-review.json
  language-calibration.json
  bounded-finalizer.json
  final-fact-review.json
  final-compliance.json
  submission-status.json
  final-response.json
  final-statement-of-objectives.txt
  usage.json
  cost.json
  attempt-accounting.json
  comparison-001-002-003-004.json
  mit-004-invention-analysis.json
  evidence-ledger.json
  render/ (PDFs)

Checkpoint directory: logs/attempts/caaa8f42-46a6-4050-bfd4-b3a20ad9da39/
  All 6 stage checkpoints persisted
  All 6 raw outputs persisted
  All 6 parsed artifacts persisted
  Usage and accounting persisted

--------------------------------

## SIX LOGICAL AI STAGES

1. Planner — PASS
2. Writer (closed-world with evidence packets) — PASS
3. Quality Reviewer (with factualRiskClaims) — PASS
4. Language Calibrator (STYLE-ONLY) — PASS
5. Bounded Finalizer (with render pressure) — PASS
6. Final Fact Reviewer — PASS (caught 1 invented fact)

No seventh stage. No regeneration loops.

--------------------------------

## KNOWN ISSUES

1. Finalizer factual discipline: The Finalizer introduced 1 invented fact during COMPRESS. The closed-world Writer constraint prevented Writer inventions (0 vs 4 in #003), but the Finalizer is not yet fully evidence-constrained during compression. This is a Phase 16+ improvement target.

2. First attempt code bug: The Planner returns factsToUse as descriptive text, not evidence IDs. The initial mapping incorrectly used these as primaryEvidenceIds, producing empty evidence packets. Fixed by validating ID format before use. Cost: $0.052 (failed planner call).

3. Action Planner did not receive factualRiskClaims in its input shape: The Quality Reviewer produced factualRiskClaims, but the Action Planner's input shape (qualityReview.componentScores) may not have threaded them through to the factualCleanup directive in this run. The factualCleanup directive was not triggered. This is a wiring issue to verify in Phase 16+.

--------------------------------

## STOP

No #005. No model change. No cost optimization. No manual rewrite.
We inspect #004 before making any further decision.

PHASE SOP-AI-15 COMPLETE — GOLDEN REGRESSION #004 CAPTURED
