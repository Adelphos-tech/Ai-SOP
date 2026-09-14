# PHASE SOP-AI-19 — UNIFIED EVIDENCE PROJECTION + SEMANTIC CLAIM GROUNDING + GOLDEN RUN INTEGRITY

## UNIFIED EVIDENCE

Canonical bundle: PASS
  - ApplicationEvidenceBundle module created: src/lib/ai/application-evidence-bundle.ts
  - buildApplicationEvidenceBundle() produces single canonical text for all stages
  - Includes ALL evidence categories: studentFacts, programFacts, facultyFacts, applicationSpecificFacts, projectClarifications
  - Schema version: evidence-bundle-v1
  - Bundle hash for checkpoint validity

Stage evidence parity: PASS
  - Planner: uses bundle.studentFactsText
  - Writer: uses bundle.studentFactsText + evidence packets
  - Quality Reviewer: uses evidence ledger
  - Language Calibrator: uses bundle
  - Bounded Finalizer: uses bundle.studentFactsText
  - Final Fact Reviewer: uses bundle.studentFactsText (FIXED — was using buildAiInput which omitted projectClarifications)

SF-CHALLENGE-PROJECT-001 visible to Stage 6: YES
  - Verified via evidence parity test (Test B)
  - Bundle text includes project clarification entry

--------------------------------

## WRITER SEMANTICS

Unsupported motivation prevention: PASS
  - MOTIVATION_PATTERNS detect: I undertook..., My goal was..., I chose..., I wanted to..., I decided to...
  - STATED_MOTIVATION requires explicit approved evidence
  - Project activity alone cannot authorize motivation (Test E)
  - runSpecificityGuard flags WRITER_UNSAFE_MOTIVATION

Novel specificity prevention: PASS
  - detectNovelSpecificity checks: frequency, location, quantity, tool, method, time, causality, result, relationship
  - WRITER_NOVEL_SPECIFICITY returned for unsupported additions
  - each lab session flagged as novel frequency + location (Tests F, G)
  - 12 percent flagged as novel quantity (Test H)
  - ETABS flagged as novel tool (Test I)

Safe paraphrase: PASS
  - planned my analysis work ahead of time for organizing my analysis work in advance → PASS (Test J)
  - validateConservativeParaphrase returns valid=true with 0 violations

Interpretive links: PASS
  - INTERPRETIVE_LINK allowed when BOTH experience fact AND interest fact exist (Test K)
  - Blocked when interest evidence missing (Test L)
  - Must reference BOTH evidence IDs

--------------------------------

## FINALIZER

Missing provenance fails closed: PASS
  - FINALIZER_GUARD_INCOMPLETE returned for COMPRESS with empty claim arrays (Test P)
  - FINALIZER_GUARD_INCOMPLETE returned for REPAIR with empty claim arrays (Test Q)
  - Phase 18 graceful fallback reverted — no longer silently infers safety

FREEZE deterministic inference:
  - FREEZE with byte-for-byte identical text: claim set may be deterministically preserved (Test R)
  - FREEZE with changed text + missing metadata: FINALIZER_GUARD_INCOMPLETE

COMPRESS missing metadata: FINALIZER_GUARD_INCOMPLETE (fail closed)
REPAIR missing metadata: FINALIZER_GUARD_INCOMPLETE (fail closed)

Stage-5 retry: PASS
  - Missing metadata classified as technical stage failure (Test S)
  - Stages 1-4 checkpoints remain valid
  - Only stage 5 retried under bounded retry policy

--------------------------------

## #005 AUDIT

Execution attempts: 3
  - Attempt A (e8be7a97): 5 paid calls, FAILED (FINALIZER_CLAIM_SET_VIOLATION), $0.385888
  - Attempt B (afeefc94): 6 paid calls, SUCCESS but 5 invented (missing evidence), $0.537202
  - Attempt C (600b1d50): 6 paid calls, SUCCESS but 1 invented + 1 altered, $0.508747

Code/config versions: 3
  - v1: pre-claim-provenance-fix
  - v2: post-claim-provenance-fix, pre-evidence-bundle-fix
  - v3: post-evidence-bundle-fix

Final successful run: $0.508747
All logged #005 cost: $1.431837 (17 paid API calls total)
Billing certainty: BILLING_STATUS_UNCERTAIN_FOR_USAGE_LOG (openai-usage.jsonl does not store costUsd; accounting.json stores costs)

Golden run integrity violation: Code was changed between attempts A, B, and C while using the same golden generation number #005. This violates the new Golden Run Immutability Policy.

Cost audit saved: logs/live-generations/mit-cee-meng-fall-2027-005/mit-005-attempt-cost-audit.json

--------------------------------

## GOLDEN POLICY

Immutable run enforcement: PASS
  - baselines/GOLDEN_RUN_POLICY.md created
  - One generation number = one immutable code/config build
  - Code change requires new generation number
  - Technical retries may reuse same generation only when code/contract/evidence/prompts unchanged
  - Content regeneration requires new generation number
  - Baseline may only be created from immutable successful golden run

Policy artifact: /opt/sop-ai-app/baselines/GOLDEN_RUN_POLICY.md

Generation Build Manifest:
  - src/lib/ai/generation-build-manifest.ts created
  - createGenerationBuildManifest() persists manifest before stage 1
  - verifyGenerationBuildManifest() verifies source hashes match
  - Records: source commit, critical file hashes, prompt hash, model config hash, contract hash, student facts hash, evidence ledger hash, evidence bundle hash, render profile, schema versions, timestamp

--------------------------------

## TESTS

Phase 19: 29/29
  - 26 tests A-Z
  - 3 integration tests (manifest, multi-attribute specificity, motivation patterns)

Complete deterministic:
  - Phase 19: 29/29
  - Phase 17: 14/14
  - Phase 16B: 18/18
  - Phase 16 (.ts): 25/25
  - Phase 14: 25/25
  - Phase 12B evidence: 76/76
  - Render deterministic fixtures: 46/46
  - Render-aware finalizer fixtures: 59/59
  - Render-aware MIT simulation: 35/35
  - Total: 327/327 (excluding 2 known tsx/CommonJS harness issues)

Known tsx/CommonJS issues (unchanged, unrelated):
  - Phase 12B runner mock: TransformError
  - Phase 16 (.mjs): TransformError

tsc: exit 0

Live OpenAI calls: 0

--------------------------------

## PRODUCTION

All endpoints: 200
  https://www.dvividconsultant.com → 200
  http://127.0.0.1:5002 → 200
  https://api.dvividconsultant.com/api/blog/getAllTopBlogs → 200
  http://127.0.0.1:5010 → 200

Frontend PM2 before: 4680
Frontend PM2 after: 4680
Delta: 0

SOP: online (restarts: 1, unchanged)
nginx: active
Production impact: NONE

Historical #001-#005: all SHA-256 hashes unchanged

--------------------------------

## NEW MODULES CREATED

- src/lib/ai/application-evidence-bundle.ts — canonical evidence bundle
- src/lib/ai/writer-claim-types.ts — claim type taxonomy + motivation/specificity detection
- src/lib/ai/specificity-guard.ts — deterministic novel specificity guard
- src/lib/ai/generation-build-manifest.ts — immutable build manifest
- baselines/GOLDEN_RUN_POLICY.md — golden run immutability policy
- tests/phase-19-unified-evidence-semantic-grounding.test.ts — 29 tests

## EXISTING MODULES MODIFIED

- src/lib/ai/pipeline/run-application-pipeline.ts — uses canonical bundle
- src/lib/ai/claim-provenance.ts — fail-closed on missing metadata, FINALIZER_GUARD_INCOMPLETE
- src/lib/ai/bounded-finalizer.ts — claimSetViolation includes FINALIZER_GUARD_INCOMPLETE
- src/lib/ai/component-action-planner.ts — blocks on SEMANTIC_EXPANSION
- src/lib/ai/prompts/generic/writer.ts — claim types, motivation rules, specificity rules
- src/lib/ai/prompts/generic/quality-reviewer.ts — SEMANTIC_EXPANSION status, claim audit
- src/lib/ai/prompts/generic/finalizer.ts — mandatory claim metadata, unsafe claim deletion
- src/lib/ai/pipeline/build-ai-input.ts — projectClarifications field
- src/types/index.ts — projectClarifications on StudentProfile

--------------------------------

## NO BASELINE CREATED

Baseline V1: NOT created (no paid generation in this phase)
No #006. No OpenAI calls. No model changes.

--------------------------------

PHASE SOP-AI-19 COMPLETE — UNIFIED EVIDENCE AND SEMANTIC CLAIM GROUNDING READY FOR IMMUTABLE GOLDEN RUN
