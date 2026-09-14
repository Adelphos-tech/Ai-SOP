# PHASE SOP-AI-21 — DETERMINISTIC CONTRACT IDENTITY + STRICT FINALIZER OUTPUT + RELIABLE STAGE RETRY

## CONTRACT IDENTITY

Runtime ID separated: PASS
  - contractId remains volatile (GC-{timestamp}-{random}) for audit purposes
  - createdAt remains volatile (ISO timestamp) for audit purposes
  - contractSemanticHash is deterministic, excludes volatile fields

Semantic hash deterministic: PASS
  - computeContractSemanticHash excludes contractId, createdAt, contractSemanticHash
  - Faculty alignment sorted by facultyName (SET-LIKE collection)
  - Response components remain ORDERED (sequence is semantically meaningful)

100-build determinism: PASS
  - Test A: 100 builds from identical inputs produce exactly 1 unique semantic hash

Real semantic changes invalidate: PASS
  - Test D: Changed student fact → different hash
  - Test E: Changed requirement → different hash
  - Test F: Changed policy → different hash
  - Test G: Changed faculty approval → different hash
  - Test H: Ordered response component change → different hash

Volatile changes do NOT invalidate: PASS
  - Test B: Different timestamps → same semantic hash
  - Test C: Different runtime IDs → same semantic hash
  - Test I: Set-like evidence ordering does not change hash

--------------------------------

## #006 RETRY REGRESSION

Old failure reproduced: YES
  - #006 root cause verified: FINALIZER_GUARD_INCOMPLETE (empty claim metadata for COMPRESS)
  - Retry blocked by STALE_CHECKPOINT_REJECTED (non-deterministic contract hash)
  - Verification saved to: logs/phase-21/006-root-cause-verification.json

Fixed semantic retry: PASS
  - Test J: Checkpoint accepts semantic-equivalent contract rebuild
  - Test AF: #006 retry reproduction now works with semantic hash
  - contractSemanticHash is identical across rebuilds with different timestamps

Manual lock deletion required: NO
  - Lock lifecycle improved with stale lock recovery (dead PID detection)
  - Test AC: Lock released after handled failure
  - Test AD: Stale dead lock recoverable
  - Test AE: Active lock not removed

--------------------------------

## FINALIZER OUTPUT

Strict schema: PASS
  - parseStage now validates Finalizer claim metadata fields are present
  - Missing retainedClaimIds/removedClaimIds/repairClaims → CONTENT_SCHEMA_INVALID (technical retryable)
  - Pipeline-level parsing distinguishes FIELD_MISSING from FIELD_EXPLICITLY_RETURNED_EMPTY

Missing metadata: TECHNICAL_STAGE_OUTPUT_INVALID
  - Test L: COMPRESS missing retainedClaimIds → FINALIZER_GUARD_INCOMPLETE
  - Test M: COMPRESS missing removedClaimIds → FINALIZER_GUARD_INCOMPLETE
  - Test N: COMPRESS missing repairClaims field → FINALIZER_GUARD_INCOMPLETE
  - Individual field missing check added to validateFinalizerClaims

COMPRESS claim partition: PASS
  - Test P: Claim partition complete → PASS
  - Test Q: Missing incoming claim → FINALIZER_CLAIM_SET_VIOLATION
  - Test R: Unknown retained claim → FAIL
  - Test S: Same ID in retained and removed → FAIL (intersection check added)
  - Test T: COMPRESS new repair claim without directive → FAIL

Repair provenance: PASS
  - Test U: COMPRESS_AND_REPAIR valid authorized repair → PASS
  - FinalizerRepairClaim type extended with claimId and contextScope

FREEZE inference: PASS
  - Test V: FREEZE exact text allows deterministic claim inference
  - Test W: FREEZE changed text → FAIL
  - claimMetadataSource = DETERMINISTIC_FREEZE_INFERENCE documented

Explicit empty accepted: PASS
  - Test O: Explicit empty repairClaims accepted where repair not required

--------------------------------

## CHECKPOINT RESUME

Stage-5 retry: PASS
  - Test X: Stage-5 invalid metadata retries Stage 5 only
  - Test Y: Stages 1-4 not rerun on Stage-5 retry
  - Test Z: Stage 6 runs after valid Stage-5 retry

Stages 1-4 rerun: 0
  - Checkpoint validation uses contractSemanticHash
  - Semantic-equivalent contract rebuild accepted

Stage 6 continues: PASS
  - Valid Stage-5 output with complete metadata allows Stage 6 to proceed

--------------------------------

## LOCKING

Normal release: PASS
  - Test AC: Lock released after handled failure
  - releaseLock handles ENOENT gracefully (lock already removed)

Dead stale lock recovery: PASS
  - Test AD: Stale dead lock recoverable
  - Lock file includes PID metadata
  - Dead PID (ESRCH) → stale lock removed, retry succeeds

Active lock protection: PASS
  - Test AE: Active lock not removed
  - Active PID → ATTEMPT_LOCKED error preserved

--------------------------------

## #006 COST

Paid calls: 5
All logged cost: $0.463744
INR: ₹44.11
Billing certainty: COMPLETE

Cost audit saved to: logs/live-generations/mit-cee-meng-fall-2027-006/006-cost-audit.json
Verified from checkpoint usage data — matches reported value.

Technical retry: 1 attempted, 0 additional paid calls (failed before API call).

--------------------------------

## PIPELINE

Logical AI stages: 6
  - Planner, Writer, Quality Reviewer, Language Calibrator, Bounded Finalizer, Final Fact Reviewer
  - Test AG: No seventh AI stage

Writer changed: NO
  - Writer semantic fixes from Phase 19 remain effective
  - No Writer scope changes in Phase 21

Render profile changed: NO
  - DVIVID_STANDARD_APPLICATION_V1 unchanged

Live OpenAI calls: 0
  - All tests are deterministic/mock
  - No paid API calls in Phase 21

Quality/Final Fact Reviewer: unchanged
  - No semantic policy changes
  - Final Fact Reviewer remains Stage 6

--------------------------------

## TESTS

Phase 21: 35/35
  - A-I: Contract semantic hash determinism (9 tests)
  - J-K: Checkpoint validation with semantic hash (2 tests)
  - L-W: Finalizer strict output validation (12 tests)
  - X-AB: Retry behavior and cost accounting (5 tests)
  - AC-AE: Lock lifecycle (3 tests)
  - AF: #006 retry reproduction (1 test)
  - AG-AI: Pipeline constraints (3 tests)

Complete deterministic:
  - Phase 21: 35/35
  - Phase 19: 29/29
  - Phase 17: 14/14
  - Phase 16B: 18/18
  - Phase 16: 25/25
  - Phase 14: 25/25
  - Phase 12B evidence: 76/76
  - Phase 12B runner mock: 1 known failure (tsx/CommonJS harness issue, unrelated)
  - Render deterministic: 46/46
  - Render-aware finalizer: 59/59
  - Render-aware MIT simulation: 35/35 (0 live OpenAI calls, historical output unchanged)

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

SOP PM2: online (restarts: 1, unchanged)
nginx: active
Production impact: NONE

Historical #001-#006: all SHA-256 hashes unchanged

--------------------------------

## FILES MODIFIED

Source code:
  - src/lib/requirements/generation-contract-types.ts — Added contractSemanticHash field
  - src/lib/requirements/generation-contract.ts — Added computeContractSemanticHash, exported, set on contract
  - src/lib/ai/pipeline-checkpoint.ts — Added contractSemanticHash to CheckpointHashes, StageCheckpoint, validateCheckpoint, findResumePoint
  - src/lib/ai/pipeline/run-application-pipeline.ts — Use semantic hash for generationContractHash, strict Finalizer parsing
  - src/lib/ai/pipeline/stage-execution.ts — Finalizer schema validation in parseStage, stale lock recovery, graceful releaseLock
  - src/lib/ai/claim-provenance.ts — Individual field missing check, intersection check, duplicate check, null safety, FinalizerRepairClaim fields
  - src/lib/ai/generation-build-manifest.ts — Added contractInstanceId and contractSemanticHash

Test fixtures:
  - tests/phase-12-fixtures.ts — Added contractSemanticHash to checkpoint fixtures
  - tests/phase-19-unified-evidence-semantic-grounding.test.ts — Added contractInstanceId/contractSemanticHash to manifest creation
  - tests/run-mit-live-006.ts — Added contractInstanceId/contractSemanticHash to manifest creation

New files:
  - tests/phase-21-deterministic-retry.test.ts — 35 tests
  - logs/phase-21/006-root-cause-verification.json
  - logs/live-generations/mit-cee-meng-fall-2027-006/006-cost-audit.json

Policy:
  - baselines/GOLDEN_RUN_POLICY.md — Phase 21 amendment (Rules 7-10)

--------------------------------

## GOLDEN RUN POLICY UPDATE

Rule 7: Contract Identity vs Contract Content
  - contractInstanceId (volatile) vs contractSemanticHash (deterministic)

Rule 8: Technical Retry Uses Semantic Hash
  - Runtime timestamp/ID difference does NOT constitute semantic change
  - Code changes still require new golden number

Rule 9: Finalizer Strict Output
  - Missing metadata = TECHNICAL_STAGE_OUTPUT_INVALID
  - Triggers bounded Stage-5 retry

Rule 10: Lock Lifecycle
  - Owner metadata, finally release, stale recovery, active protection

--------------------------------

PHASE SOP-AI-21 COMPLETE — DETERMINISTIC CHECKPOINT RETRY READY FOR GOLDEN #007
