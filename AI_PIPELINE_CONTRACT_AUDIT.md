# AI Pipeline Contract Audit — Phase 1 Report

Date: 2026-09-19 · Zero OpenAI calls · Zero generations · Read-only audit

## Architecture inventory

Two validation layers exist (by design):

| Stage | Prompt | Type | Parser (fatal) | Semantic validator (fatal) | Downstream consumers |
|---|---|---|---|---|---|
| Planner | `prompts/generic/planner.ts` | none (implicit) | `parseStage` — `componentPlans[]` non-empty, `componentId` text | — | `plannerSelection` → `buildComponentEvidencePackets`; `buildGenericWriterPrompt(plan)` |
| Writer | `prompts/generic/writer.ts` | `WriterClaim*` | `parseStage` — `responses[].text` non-empty | `validateWriterEvidenceReferences` — evidence IDs ⊆ authorized | claim extraction (line 831), LC input |
| Quality Reviewer | `prompts/generic/quality-reviewer.ts` | `QualityReviewOutput` | `parseStage` — `requirementCompliance` object, `score` 1–10 | `validateQualityReviewOutput` | `planComponentActions`, `validateFinalizerActionPlan` |
| Language Calibrator | `prompts/generic/language-calibrator.ts` | implicit | `parseStage` — `responses[].text` | `validateLanguageCalibratorClaims` — claimId set preserved, no drops | `buildCalibratedClaims`, finalizer input |
| Finalizer | `prompts/legacy/finalizer-generic.ts` | `FinalizerResponse` | `parseStage` — `text` + claim-metadata keys present/arrays | `validateFinalizerActionPlan`, `validateFinalizerOutput`, `validateFinalizerClaims` | final responses → FR input |
| Fact Reviewer | `prompts/generic/final-fact-reviewer.ts` | `FactReviewOutput` | `parseStage` — `overallPass` bool, `components[].pass/claims` | `validateFactReviewOutput` | `deriveFactReviewTotals` → `computeSubmissionStatus` |

## Confirmed contract mismatches

### C1 — CRITICAL — FR `blockingReason` omitted → fatal (PRODUCTION BUG, 2 runs killed)

- Prompt schema: `"blockingReason": null or "reason"` — emits in example, but model may omit on `overallPass: true`
- Validator (`model-output-types.ts:258`): `o.blockingReason !== null && !isString(...)` — **`undefined` fails the check** → `FACT_REVIEWER_OUTPUT_INVALID` → generation dies at stage 6
- Downstream: never read directly (stored in factReview for audit only)
- Root cause: validator written for `null`-only absence; undefined not tolerated
- Fix: accept `undefined`/`null`; normalize to `null`

### C2 — CRITICAL — FR totals required by parseStage (already fixed in d40b1b0)

- Prompt says "Do NOT return totals"; validator demanded them → `invalid fact review` killed runs `05759a8e`/`7356b004`
- Fixed: totals now optional-but-validated; `deriveFactReviewTotals` computes server-side

### C3 — HIGH — FR claim `text` alias not normalized

- Type documents `text?: string` as an alias ("some model outputs use 'text'")
- Validator requires `claim` — a model emitting `text` instead → fatal
- Downstream stores `cl.claim` in factReview — a `text`-only claim would also display empty
- Fix: normalize `text`→`claim` before validation; accept either

### C4 — HIGH — LC prompt self-contradiction

- System: "omit `rewrittenText` when preserved verbatim" (compact contract)
- User tail: "every claimId MUST appear… **with a non-null rewrittenText**" — contradicts
- Consumer (`buildCalibratedClaims`) handles both correctly: omitted→verbatim, `null`→dropped-claim violation (intended)
- No runtime failure possible from this drift, but the conflicting instruction confuses the model and wastes output tokens
- Fix: rewrite user-prompt tail to match compact semantics

### C5 — MEDIUM — Planner evidence-selection field names dead

- Prompt emits `studentEvidenceIds`/`programEvidenceIds`/`facultyEvidenceIds`
- Consumer (`run-application-pipeline.ts:792-793`) reads `primaryEvidenceIds`/`secondaryEvidenceIds` — **fields the prompt never defines**
- Result: `looksLikeIds` check always false → planner's evidence selection is silently discarded → evidence packets always fall back to all entries
- No failure, but the planner's evidence-curation work is wasted output tokens
- Fix: consumer reads the emitted fields (union of the three → primary set)

### C6 — LOW — QR `reason`/`supportingEvidenceIds`/`claim` still required on risk claims

- Compact QR emits them; validator requires them — consistent today
- Downstream (`planComponentActions`) consumes `claim` + `status` + `supportingEvidenceIds`; `reason` is diagnostic only
- Safe to keep required (prompt guarantees emission); documented here for awareness

### C7 — LOW — `parseStage` component-list check rejects empty `components[]`

- `!items.length` → fatal. For FR, zero components is structurally impossible (writer produced ≥1) — correct to keep fatal
- No change needed

### Fatal-validation classification (spec §10)

| Check | Stage | Fatal today | Should be |
|---|---|---|---|
| Unparseable JSON | all | yes | MUST FAIL |
| Missing component list / empty | all | yes | MUST FAIL |
| Missing/empty `text` (writer/LC/finalizer) | — | yes | MUST FAIL (no text = unusable) |
| QR score not 1–10 | QR | yes | MUST FAIL (action planner consumes) |
| QR `requirementCompliance` absent | QR | yes | NORMALIZE → derive from limits (future); keep fatal now (consumed) |
| Finalizer claim-metadata keys absent | FIN | yes | MUST FAIL for non-FREEZE (provenance); FREEZE exempt via inference |
| FR `overallPass` absent | FR | yes | MUST FAIL (safety decision input — though derived, absence signals malformed output) |
| FR per-component `pass`/`claims` absent | FR | yes | MUST FAIL |
| FR totals absent | FR | yes → **fixed** | WARNING/DERIVE ✓ |
| FR `blockingReason` absent | FR | yes | NORMALIZE → `null` ✓ fix |
| FR claim `text` alias | FR | yes | NORMALIZE → `claim` ✓ fix |
| Extra unknown fields | all | no | ignore ✓ already |

**Is the pipeline overly brittle? YES** — fatal validation sits at *parse time* before normalization, and derived fields were previously required from the model. The two-layer design (parseStage + semantic validators) is sound; the drift was parseStage being stricter than the prompt contract.

## Duplicate validators

`parseStage` (shape/parse) and `validate*Output` (semantic) — two layers by design. The drift was between them, not redundancy. Keeping both; the parse layer now normalizes before strict checks.

## Checkpoint/historical compatibility

Legacy full outputs (with totals, `reason`, `supportingSourceIds`, `rewrittenText` always present) remain valid under the new validators — all legacy-required fields still accepted. Compact outputs (totals omitted, `rewrittenText` omitted, `verifiedClaimIds` IDs-only) now pass both layers.

## Files changed (Phase 2)

- `src/lib/ai/pipeline/stage-execution.ts` — FR claim `text`→`claim` normalization; per-stage error codes; contract-version stamp
- `src/lib/ai/model-output-types.ts` — `blockingReason` accepts `undefined`→`null`
- `src/lib/ai/prompts/generic/language-calibrator.ts` — fix contradictory user-prompt tail
- `src/lib/ai/pipeline/run-application-pipeline.ts` — planner evidence-selection reads emitted fields
- `src/lib/ai/pipeline/stage-contracts.ts` — NEW: contract version constants + per-stage required/optional matrix (documentation-as-code)
