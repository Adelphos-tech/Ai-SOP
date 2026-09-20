# GENERATION POLICY NORMALIZATION

**Date:** 2026-09-20 · **OpenAI calls:** 0 · **Generations:** 0 · **Stages:** 6 unchanged

## Principle applied

```
TECHNICAL / DATA-INTEGRITY FAILURE        → FAILED
CONTENT / QUALITY / COMPLIANCE UNCERTAINTY → repair if possible → COMPLETE + warning
SAFETY uncertainty                       → preserve last safe text → warning
```

## What changed

| Code | Before | Now |
|---|---|---|
| MISSING_REQUIRED_STUDENT_INFORMATION (pre-gate) | abort before any stage | fatal only if **zero** student evidence; else `TOPIC_EVIDENCE_UNCERTAIN` warning |
| MISSING_REQUIRED_STUDENT_INFORMATION (post-LC) | abort after 4 paid stages | `TOPIC_EVIDENCE_MISSING` warning — no fabrication, draft completes |
| REQUIRED_TOPIC_COVERAGE_UNKNOWN | abort | warning |
| FINALIZER_EVIDENCE_VIOLATION | abort | warning |
| RENDER_VALIDATION_REQUIRED | abort | `PAGE_LIMIT_WARNING` |
| WRITER_EVIDENCE_REFERENCE_VIOLATION | abort | warning (Fact Reviewer still audits final claims) |
| QUALITY_REVIEWER_OUTPUT_INVALID | abort | warning (planner degrades to FREEZE) |
| LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM | abort | warning + **Writer text kept** (safe fallback, no unsafe claims) |
| BOUNDED_FINALIZER_BLOCKED | abort | warning + calibrated draft kept |
| FINALIZER_METADATA_INCOMPLETE (×3) | abort | warning + calibrated draft kept |
| FINALIZER_GUARD_FAILED | abort | warning + calibrated draft kept + re-render |
| CLAIM_PROVENANCE_VIOLATION | abort | warning + calibrated draft kept |

## Still fatal (technical integrity)

`GENERATION_CONTRACT_REQUIRED`, `INVALID_GENERATION_ID`, `STAGE_EXECUTION_INIT_FAILED`, provider transport/parse failures after retries, zero-evidence profile, missing calibrated text (`FINALIZER_SCOPE_VIOLATION`), `FACT_REVIEWER_OUTPUT_INVALID`, new `EMPTY_FINAL_DOCUMENT`, context gates (no profile, LOR recommender context, visa evidence, unapproved fact sheet).

## Warning surface

`ApplicationPipelineResult.warnings: {code,message}[]` → `body.warnings` → amber "Completed with warnings — review before use" card in the document UI. Post-final checks (topic coverage, page limit, fact review flags) also emit granular warning codes.

Six-stage architecture, closed-world writer, claim provenance, fact review, Zod validation — **all unchanged**. Consultants keep View/Edit/Approve authority.

Verified: `tsc` clean, `next build` clean, zero-token preflight **32/32 PASS**.

GENERATION POLICY NORMALIZED — QUALITY ISSUES WARN, TECHNICAL FAILURES BLOCK
