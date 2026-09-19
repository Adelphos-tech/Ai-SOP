# Zod Stage Contract Migration

Date: 2026-09-19 · zod@3.25.76 (stable, mature line — avoided brand-new v4 API churn)

## What changed

**New:** `src/lib/ai/schemas/` — one structural schema per stage:

| File | Schema | Contract |
|---|---|---|
| `common.ts` | shared helpers (`componentArray`, `nonEmptyText`, `componentId`, `looseObject`, `optionalCount`) | — |
| `planner.schema.ts` | `PlannerOutputSchema` | planner-v1 |
| `writer.schema.ts` | `WriterOutputSchema` | writer-v1 |
| `quality-reviewer.schema.ts` | `QualityReviewerOutputSchema` | quality-reviewer-v2 |
| `language-calibrator.schema.ts` | `LanguageCalibratorOutputSchema` | language-calibrator-v2 |
| `finalizer.schema.ts` | `FinalizerOutputSchema` | finalizer-v1 |
| `fact-reviewer.schema.ts` | `FactReviewerOutputSchema` | fact-reviewer-v2 |
| `index.ts` | `STAGE_OUTPUT_SCHEMAS` registry | — |

**Rewired:**

- `parseStage` (stage-execution.ts): `JSON.parse` → `normalizeStageOutput` → `schema.safeParse` → context-dependent finalizer domain check → `_contractVersion` stamp. All per-stage `if typeof/isArray/===undefined` branches deleted.
- `validateQualityReviewOutput` / `validateFactReviewOutput` (model-output-types.ts): delegate to the same schemas — one structural source of truth, no drift possible.
- Types in `model-output-types.ts` are now `z.infer<>` of the schemas — required/optional/nullability declared once.
- Errors: `AI_STAGE_SCHEMA_INVALID` with zod issue paths/codes (internal diagnostics only — never applicant content). Finalizer claim-metadata failures preserve the legacy technical-retryable flag.

## Semantics preserved exactly

- **FR `blockingReason`**: omitted/null/string → normalized to `null` (output type `string | null`)
- **FR claim `text` alias**: normalized to `claim` before + inside schema (transform)
- **FR totals**: optional; validated as non-negative ints when present; derived server-side otherwise
- **LC `rewrittenText`**: `.nullish()` — omitted vs `null` distinction preserved (omitted=verbatim, null=dropped→domain violation)
- **Finalizer**: three metadata arrays required structurally; non-empty-for-non-FREEZE stays a context-aware domain check in `parseStage`
- **QR**: advisory fields optional; topicCoverage/candidateEvidence inner fields optional-but-typed (legacy validator never checked them — required would introduce a NEW fatal path)
- **Planner**: reads `student/program/facultyEvidenceIds` (+ legacy `primary/secondaryEvidenceIds` tolerated)
- **Extra fields**: `.passthrough()` everywhere — harmless extras never reject
- **Safety enums**: strict — unknown classification/severity/status still fail

## Separation of concerns

| Stage | Zod (structural) | Normalizer | Domain validator (unchanged) | Derived server-side |
|---|---|---|---|---|
| Planner | shape, componentIds | — | ledger-ID intersection + fallback | — |
| Writer | responses+text, claim shapes | — | `validateWriterEvidenceReferences` | claimId synthesis |
| QR | scores, enums, arrays | — | `planComponentActions` evidence/topic checks | — |
| LC | responses+text, claimMap | omitted→verbatim | `validateLanguageCalibratorClaims` | verbatim fallback |
| Finalizer | responses+text, metadata arrays | — | `validateFinalizerActionPlan`, `validateFinalizerOutput`, `validateFinalizerClaims` | FREEZE inference |
| FR | components, enums, `overallPass` | `text`→`claim`, `blockingReason`→null | `deriveFactReviewTotals` + submission status | all 4 totals + `overallPass` overwrite |

## Invariants

- Contract versions: **unchanged** (`planner-v1` … `fact-reviewer-v2`)
- Prompts/models/token ceilings/Background Responses: **unchanged**
- Checkpoint/legacy outputs: readable — schemas accept the legacy full shapes (totals present, `rewrittenText` present, all advisory fields)
- Removed hand-rolled structural checks: ~120 LOC across `parseStage` + `model-output-types`
- Domain validators removed: **0** · Safety rules weakened: **0**

## Verification

- `tsc --noEmit`: clean
- `tests/compact-contract-tests.ts` fixture updated: claim used invalid QR enums (`SUPPORTED`/`LOW`) in an FR context — corrected to `SUPPORTED_STUDENT_FACT`/`INFO`
- No tests executed · No generations · No OpenAI calls
