# PHASE SOP-AI-16 — CLAIM-PROVENANCE FINALIZER + MISSING-TOPIC FAIL-CLOSED

## APPLICATION

Application: /opt/sop-ai-app/
Pipeline: GENERIC
Phase: 16
Live OpenAI calls: 0
Paid API calls: 0

--------------------------------

## #004 ROOT CAUSE

Topic: unforeseen challenges
Mandatory: YES (from official MIT CEE prompt: "how you dealt with unforeseen challenges")
Authorized evidence available: YES (SF-STORY = personalStory.challenges = "Limited access to advanced engineering software.")
Evidence adequate: NO (general background challenge, NOT project-specific)
Planner warning: "Do not claim that limited software access affected this specific project unless the student confirms the connection."
Correct expected behavior: BLOCK (MISSING_REQUIRED_STUDENT_INFORMATION — evidence is inadequate for this mandatory topic in project context)
Claim introduced by: FINALIZER

Root cause chain:
1. Writer correctly omitted the unsupported claim (0 Writer inventions)
2. Language Calibrator did not introduce it (0 Calibrator inventions)
3. Quality Reviewer marked "unforeseen challenges" as not covered, returned allowedEvidenceIds: ['SF-STORY']
4. Action Planner produced COMPRESS_AND_REPAIR (overflow + missing topic + evidence available)
5. Finalizer used SF-STORY as repair evidence and wrote: "An unforeseen challenge was limited access to advanced engineering software."
6. Finalizer guard passed (structural validation only — checked evidence ID authorization)
7. No claim provenance model existed to track that Writer had deliberately omitted this claim
8. Final Fact Reviewer (Stage 6) correctly caught it as INVENTED_FACT

Phase 16 fix:
- Claim provenance model: Writer claims get stable IDs, Finalizer can only retain/remove/repair
- COMPRESS cannot add new claims: FINAL_CLAIMS ⊆ PRE_FINAL_CLAIMS
- Repair claims must reference only authorized evidence IDs
- Missing mandatory topic + no evidence → MISSING_REQUIRED_STUDENT_INFORMATION
- Finalizer guard extended with claim provenance validation
- Final Fact Reviewer remains the semantic authority (Stage 6)

--------------------------------

## CLAIM PROVENANCE

Writer claim IDs: PASS
  - Writer produces claims with stable IDs (CLAIM-<componentId>-<NNN>)
  - 26 claims extracted from #004 Writer output
  - Writer correctly omitted the software-access claim

Language preservation: PASS
  - Language Calibrator may retain/remove/rephrase claims
  - May NOT introduce unknown claim IDs
  - Violation: LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM

Finalizer inheritance: PASS
  - Finalizer returns retainedClaimIds, removedClaimIds, repairClaims
  - retainedClaimIds must exist in pre-final claim set
  - removedClaimIds must exist in pre-final claim set
  - retained + removed = pre-final set (no claims unaccounted for)

New claim prevention: PASS
  - COMPRESS: repairClaims must be empty (no new claims)
  - FREEZE: claim set must be identical
  - TARGETED_COMPLIANCE_REPAIR / COMPRESS_AND_REPAIR: repair claims allowed with constraints

Authorized repair: PASS
  - Repair topic must be a missing topic
  - Repair evidence IDs must be in the allowed list for that topic
  - Repair evidence IDs must be non-empty
  - Violations: FINALIZER_UNAUTHORIZED_REPAIR, FINALIZER_EVIDENCE_VIOLATION

Required-topic preservation: PASS
  - Compression cannot remove the last supported claim for a mandatory topic
  - Violation: FINALIZER_REQUIRED_TOPIC_LOST

--------------------------------

## FINALIZER GUARD

valid boolean: PASS
  - Always true or false, never undefined
  - Extended with newFactualClaimViolation, unauthorizedRepairViolation, claimSetViolation

New factual claim detection: PASS
  - FINALIZER_NEW_FACTUAL_CLAIM: COMPRESS introduces repair claims
  - FINALIZER_UNKNOWN_CLAIM: retained/removed claim ID not in pre-final set

Unauthorized repair detection: PASS
  - FINALIZER_UNAUTHORIZED_REPAIR: repair for non-missing topic or non-repair action
  - FINALIZER_EVIDENCE_VIOLATION: repair uses unauthorized evidence ID

--------------------------------

## PIPELINE

Logical AI stages: 6
  1. Planner
  2. Writer (closed-world + claim IDs)
  3. Quality Reviewer (factualRiskClaims)
  4. Language Calibrator (STYLE-ONLY + claim preservation)
  5. Bounded Finalizer (claim inheritance + structured output)
  6. Final Fact Reviewer (semantic validation)

Final Fact Reviewer: Stage 6
Seventh AI call: NO
  - Claim provenance validation is deterministic (no AI call)
  - Missing mandatory topic check is deterministic (no AI call)

--------------------------------

## #004 SIMULATION

Unsupported software challenge allowed: NO (expected: NO)
Result: PASS

Simulation details:
  - Writer claims: 26 (none about software access)
  - Action: COMPRESS_AND_REPAIR (overflow + missing "unforeseen challenges" + SF-STORY)
  - Phase 16 structural validation: PASS (SF-STORY is authorized for "unforeseen challenges")
  - Stage 6 semantic validation: FAIL (INVENTED_FACT — general background miscontextualized as project-specific)
  - Net result: unsupported challenge NOT allowed in final output

  If action had been COMPRESS (no repair):
    - Phase 16 would block: FINALIZER_NEW_FACTUAL_CLAIM
    - Blocked at Finalizer: YES

  Correct expected behavior: BLOCK (MISSING_REQUIRED_STUDENT_INFORMATION)
    because evidence is inadequate (general background, not project-specific)

--------------------------------

## TESTS

Phase 16: 25/25
  A. COMPRESS with same claim set — PASS
  B. COMPRESS removes claims — PASS
  C. COMPRESS adds new claim — FINALIZER_NEW_FACTUAL_CLAIM
  D. Finalizer invents unsupported software challenge — FAIL
  E. Paraphrased unsupported software challenge — FAIL
  F. Mandatory missing topic + no evidence — BLOCK
  G. Optional reviewer suggestion + no evidence — IGNORE
  H. Mandatory missing topic + authorized evidence — repair allowed
  I. Repair uses unauthorized evidence — FINALIZER_UNAUTHORIZED_REPAIR
  J. Language Calibrator preserves claim IDs — PASS
  K. Language Calibrator creates unknown claim ID — VIOLATION
  L. FREEZE claim set changes — FAIL
  M. Compression removes mandatory-topic last claim — REQUIRED_TOPIC_LOST
  N. Compression removes secondary redundant claim — PASS
  O. Finalizer guard valid always boolean — PASS
  P. Guard false prevents READY_TO_SUBMIT — PASS
  Q. Stage 6 still runs after provenance PASS — PASS
  R. Stage 6 remains logical stage 6 — PASS
  S. No seventh AI call — PASS
  T. Checkpoint invalid after claim-set change — PASS
  U. Generic single-component application — PASS
  V. Generic three-component application — PASS
  W. No university-specific logic — PASS
  X. Harvard AI-policy regression remains blocked — PASS
  Y. #004 historical software challenge regression — PASS

Complete deterministic suite:
  Phase 12b evidence enforcement: 76/76
  Phase 14 evidence constrained writer: 25/25
  Phase 16 claim provenance finalizer: 25/25
  Total: 126/126

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

SOP app: online (restarts: 1, unchanged)
nginx: active
Production impact: NONE

Historical #001-#004: all SHA-256 hashes unchanged
OpenAI usage log: 88 lines (unchanged — no new calls)

--------------------------------

## ARTIFACTS

New files:
  src/lib/ai/claim-provenance.ts — Claim provenance model + deterministic validator
  tests/phase-16-claim-provenance-finalizer.test.ts — 25 deterministic tests
  tests/simulate-004-phase16.ts — #004 historical simulation
  logs/phase-16/mit-004-finalizer-invention-analysis.json — Root cause analysis
  logs/live-generations/mit-cee-meng-fall-2027-004/phase-16-simulation.json — Simulation result

Modified files:
  src/lib/ai/prompts/generic/writer.ts — Added claimId to factualClaims
  src/lib/ai/prompts/generic/language-calibrator.ts — Added claimMap preservation
  src/lib/ai/bounded-finalizer.ts — Structured claim output + extended guard
  src/lib/ai/pipeline/run-application-pipeline.ts — Claim provenance wiring

--------------------------------

## STOP

No #005. No live OpenAI calls. No model change. No cost optimization.
No manual rewrite. No render profile change.

PHASE SOP-AI-16 COMPLETE — CLAIM-PROVENANCE FINALIZER READY FOR FINAL GOLDEN TEST
