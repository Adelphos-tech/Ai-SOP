# PHASE SOP-AI-33B — FINALIZER PROVENANCE CORRECTNESS + RELEASE LOCK

## COMPRESS PROVENANCE

Blind all-retained inference removed: YES

Explicit metadata validated: YES

Bounded retry used when incomplete: YES

Fail closed after retry: YES

### What changed

**File:** `src/lib/ai/claim-provenance.ts`

Removed the Phase 33A fallback that inferred all pre-final claims as retained when COMPRESS returned empty `retainedClaimIds` and `removedClaimIds`. COMPRESS may legitimately rewrite or omit material, so blindly marking every claim as retained is incorrect.

**File:** `src/lib/ai/pipeline/stage-execution.ts`

Extended `parseStage` to detect empty claim metadata (both `retainedClaimIds` and `removedClaimIds` empty) for non-FREEZE components. When detected, it throws `FINALIZER_METADATA_INCOMPLETE` with `technical=true`, which triggers the existing bounded technical retry infrastructure (`maxTechnicalRetries` in `createStageExecution`). FREEZE components are exempted because the deterministic FREEZE inference (byte-for-byte text comparison) in `claim-provenance.ts` handles that case.

**File:** `src/lib/ai/pipeline/run-application-pipeline.ts`

The finalizer stage execution now passes `freezeComponentIds` (the set of component IDs with action `FREEZE`) to `parseStage` via the `context` parameter, so `parseStage` can distinguish FREEZE from COMPRESS/REPAIR.

### How it works

1. Model returns COMPRESS with complete metadata → existing validation runs → PASS/FAIL
2. Model returns COMPRESS with empty metadata → `parseStage` throws `FINALIZER_METADATA_INCOMPLETE` (technical retryable) → existing technical retry loop re-calls the finalizer
3. After retry, model returns valid metadata → existing validation runs → PASS
4. After retry, model still returns empty metadata → `parseStage` throws again → retry limit exceeded → FAIL CLOSED
5. If retry limit is reached and metadata is still incomplete, the pipeline returns `FINALIZER_METADATA_INCOMPLETE` and does NOT save a `DocumentVersion`

### Retry instruction

The existing finalizer prompt already requires `retainedClaimIds`, `removedClaimIds`, and `repairClaims` for every response component. The retry uses the same prompt, so the model receives the same instruction. The `FINALIZER_METADATA_INCOMPLETE` error code is classified as technical, so the existing retry loop re-executes the finalizer stage with the same prompt.

---

## FREEZE

Existing behavior unchanged: YES

The deterministic FREEZE inference (byte-for-byte text comparison → all claims retained) in `claim-provenance.ts` is unchanged. FREEZE components with empty metadata and identical text still pass via deterministic inference. FREEZE components with changed text and empty metadata still fail with `FINALIZER_GUARD_INCOMPLETE`.

---

## FACT REVIEW

Final Fact Reviewer unchanged: YES

Fact safety and claim retention treated separately: YES

The Final Fact Reviewer (stage 6) remains the semantic authority for fact safety (invention, alteration, support). Claim provenance validation (stage 5 guard) checks preservation/removal of prior claims. Passing Final Fact Review does NOT prove all pre-final claims were retained. The two concerns are validated by separate deterministic checks.

---

## DATABASE SECURITY

Runtime account: sop_app@127.0.0.1

Privileges: SELECT, INSERT, UPDATE, DELETE on sop_ai_app.*

DDL runtime privileges: NO

### Audit details

Before Phase 33B:

```
GRANT ALL PRIVILEGES ON `sop_ai_app`.* TO `sop_app`@`127.0.0.1`
```

After Phase 33B:

```
GRANT SELECT, INSERT, UPDATE, DELETE ON `sop_ai_app`.* TO `sop_app`@`127.0.0.1`
```

`ALL PRIVILEGES` was revoked and replaced with DML-only grants. The runtime application does not require CREATE, ALTER, DROP, INDEX, or other DDL privileges. The schema is managed by the `init-schema.ts` script run separately with root privileges.

---

## TESTS

Phase 33B: 40/40

Phase 33: 196/196

Phase 32b: 85/85

Phase 32: 78/78

TypeScript: PASS

### Phase 33B test coverage

| Test | Description | Result |
|------|-------------|--------|
| A | COMPRESS with complete valid metadata → PASS | PASS |
| B | COMPRESS with empty metadata does NOT automatically mark all claims retained | PASS |
| C | COMPRESS missing metadata invokes existing bounded retry behavior | PASS |
| D | Valid retry metadata → PASS | PASS |
| E | Invalid retry metadata → FAIL CLOSED | PASS |
| F | Unknown claim ID → FAIL | PASS |
| G | Duplicate classification → FAIL | PASS |
| H | Same claim retained + removed → FAIL | PASS |
| I | Removed claim is represented correctly | PASS |
| J | FREEZE behavior unchanged | PASS |
| K | Final Fact Reviewer behavior unchanged | PASS |
| L | Exactly six AI stages remain | PASS |
| M | Successful DocumentVersion not created when Finalizer Guard fails | PASS |

---

## BUILD

Clean production build: PASS

Manual framework artifact: NO

`rm -rf .next && npm run build` exited with code 0. `prerender-manifest.json` generated naturally by Next.js 14.2.5. No fabricated framework artifacts.

---

## PRODUCTION

All endpoints: 200

- SOP (5010): 200
- Frontend (5002): 200

Unexpected PM2 delta: 0

- SOP: 1 intentional restart (clean build deployment), 0 unexpected restarts, 0 unstable restarts
- Frontend: 0 unexpected restarts

nginx: active

Production impact: NONE

### Phase 33A artifact preservation

Phase 33A Version 1 (generation ID `547a3907-f805-4cb8-8d67-298df4830558`) is preserved in the database. No rerun was performed.

---

## FILES CHANGED

1. `src/lib/ai/claim-provenance.ts` — Removed COMPRESS blind all-retained inference fallback
2. `src/lib/ai/pipeline/stage-execution.ts` — Added `FINALIZER_METADATA_INCOMPLETE` check in `parseStage` for non-FREEZE components with empty claim metadata; added `context` parameter to `execute` and `parseStage`
3. `src/lib/ai/pipeline/run-application-pipeline.ts` — Pass `freezeComponentIds` to finalizer stage execution
4. `tests/phase-33b-finalizer-provenance-tests.ts` — New deterministic test suite (40 tests)

---

PHASE SOP-AI-33B COMPLETE — FINALIZER PROVENANCE RELEASE LOCKED
