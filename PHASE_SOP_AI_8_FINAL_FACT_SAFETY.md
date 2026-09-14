# PHASE SOP-AI-8 — Generic Application Pipeline + Final Factual Safety Gate

**Date:** Wed 9 Sep 2026
**Phase:** SOP-AI-8 — Architecture Hardening
**Objective:** Harden the application-controlled generation architecture before any cost optimization or second live generation. No live generation in this phase.

---

## GENERIC PRODUCTION PIPELINE: PASS

The MIT-specific pipeline (`run-mit-cee-pipeline.ts`) and MIT-specific prompts (`prompts/mit-cee/*`) were **removed**.

A single generic pipeline now exists:

```
GenerationContract (carries: responseComponents, facultyAlignment, programContext, pageLimit)
        ↓
Generic Planner (contract-driven)
        ↓
Generic Writer (contract-driven)
        ↓
Generic Quality Reviewer
        ↓
Generic Language Calibrator
        ↓
Generic Finalizer
        ↓
Generic Final Fact Reviewer (audits ACTUAL final text)
        ↓
Deterministic post-final checks (no AI)
        ↓
FinalCompliance + SubmissionStatus
```

**Production files:**

| File | Role |
|---|---|
| `src/lib/ai/pipeline/run-application-pipeline.ts` | Generic 6-stage pipeline |
| `src/lib/ai/prompts/generic/planner.ts` | Generic planner prompt |
| `src/lib/ai/prompts/generic/writer.ts` | Generic writer prompt |
| `src/lib/ai/prompts/generic/quality-reviewer.ts` | Generic quality reviewer prompt |
| `src/lib/ai/prompts/generic/language-calibrator.ts` | Generic language calibrator prompt |
| `src/lib/ai/prompts/generic/finalizer.ts` | Generic finalizer prompt |
| `src/lib/ai/prompts/generic/final-fact-reviewer.ts` | Final fact reviewer prompt (stage 6) |
| `src/lib/output/submission-status.ts` | Submission status model |
| `src/lib/output/post-final-checks.ts` | Deterministic checks (no AI) |
| `src/lib/review/fact-taxonomy.ts` | Strict fact taxonomy |
| `src/app/api/sop/generate-application/route.ts` | Generic API endpoint |
| `src/app/api/sop/generate-mit-cee/route.ts` | Thin adapter (artifact loading only) |

---

## UNIVERSITY-SPECIFIC HARD CODING: NONE

Verified that no university-specific logic remains in production pipeline code:

| Area | Check | Result |
|---|---|---|
| `src/lib/ai/pipeline/` | Only generic pipelines remain | PASS |
| `src/lib/ai/prompts/` | Only generic prompts in `generic/` | PASS |
| Pipeline branching by university | None — contract-driven | PASS |
| Hardcoded faculty names in pipeline | None | PASS |
| Hardcoded component labels ("Experience"/"Purpose") in pipeline | None — labels come from contract | PASS |
| Contract builder messages | Made generic ("Faculty alignment" instead of "MIT faculty alignment") | PASS |

**Remaining MIT references (legitimate):**
- `domain-verification.ts` — MIT in the university domain registry **data** (expected)
- `generation-contract-types.ts` — MIT only in **doc comments** (examples)
- `generate-mit-cee/route.ts`, `FacultyAlignmentPanel.tsx`, `sop-result-mit-cee/page.tsx`, `faculty-alignment/route.ts` — **adapter/UI layer** for the MIT test application; they load artifacts and contain no pipeline logic.
- `Prompts` directory — the old hardcoded `mit-cee` prompts were **deleted**.

---

## GENERIC RESPONSE-COMPONENT MODEL: PASS

The generic pipeline handles any response-component count:

- 1 document + 1 response (SOP)
- 1 document + multiple responses (MIT CEE A/B — via contract)
- N short answers — via contract
- Personal Statement / Motivation Letter / Study Plan — document type label comes from contract

No application name is hardcoded into pipeline/prompt logic.

---

## GENERIC FACULTY / PROGRAM CONTEXT: PASS

Faculty alignments are consumed generically from `applicationSpecificFacts`/`facultyAlignment` in the GenerationContract. Test G confirms a different university's faculty (Prof. Generic/Other) flows through the same prompt builders with no MIT-specific code.

---

## FACT TAXONOMY: PASS

Strict definitions in `src/lib/review/fact-taxonomy.ts`:

- SUPPORTED_STUDENT_FACT — directly supported by approved student facts
- SUPPORTED_PROGRAM_FACT — supported by verified official program sources
- SUPPORTED_FACULTY_FACT — supported by verified official faculty sources
- INTERPRETIVE_ELABORATION — narrative interpretation, no new specific fact
- ALTERED_FACT — supported item whose value/detail changed (e.g., 3-month → 6-month)
- INVENTED_FACT — new specific assertion with no approved supporting source
- AMBIGUOUS — cannot confidently classify

**An item cannot simultaneously be INVENTED_FACT and "not fabricated."**

---

## MIT DISPUTED FACT RECLASSIFICATION

**Audit record:** `logs/live-generations/mit-cee-meng-fall-2027-001/mit-live-001-fact-classification-review.json`

| Field | Value |
|---|---|
| Original (informal SOP-AI-7 note) | "minor elaboration" / treated leniently |
| Exact claim | Student dealt with limited software access by "working carefully within available access and deliberately concentrating computational work in MATLAB and SAP2000" |
| Supporting evidence | Student facts record only the challenge ("limited access to advanced engineering software"); tools MATLAB/SAP2000 are supported by the project fact |
| Corrected classification | **INVENTED_FACT** |
| Reason | The specific coping strategy is a new factual assertion not present in the approved facts. The tools are supported; the strategy is not. |
| Severity | WARNING |

The historical generated text was not modified. Classification corrected per strict taxonomy — NOT downgraded to reach zero.

---

## FINAL-OUTPUT FACT REVIEWER: PASS

- Fact Reviewer moved from stage 3 to **stage 6 (final stage)**.
- It now audits the **actual final submitted text** (Finalizer output), not the Writer draft.
- Strict taxonomy applied in prompt.
- Returns structured per-claim results with classification, supporting fact/source IDs, and severity.

**Data-dependency verification:** QualityReviewer needs writer output (has it); LanguageCalibrator needs writer output (has it); Finalizer needs writer output + quality + calibrated (has all); FinalFactReviewer needs finalizer output + facts (has all). No circular dependency. 

---

## SIX-STAGE MAXIMUM: PASS

- MAX_PIPELINE_CALLS remains **6**.
- Stage order changed to: Planner → Writer → Quality Reviewer → Language Calibrator → Finalizer → Final Fact Reviewer.
- No 7th OpenAI call added.
- Deterministic post-final checks are code-only (no AI).

---

## FINAL FACT FAILURE → REVIEW_REQUIRED: PASS

If the final fact review finds invented or altered facts:

```
submissionStatus = REVIEW_REQUIRED
```

The document is NOT presented as READY_TO_SUBMIT. No automatic 7th-call repair. No uncontrolled regeneration loop.

---

## SUBMISSION STATUS MODEL: PASS

```
DRAFT_GENERATED
    ↓ fact pass + page constraint present
READY_FOR_RENDER_VALIDATION
    ↓ fact pass + all deterministic checks pass + no unresolved constraint
READY_TO_SUBMIT
```

**MIT currently** (factual gate corrected to 1 invented fact under strict taxonomy): REVIEW_REQUIRED — pending consultant review of that claim.

Even with factual PASS, the MIT page constraint keeps it at READY_FOR_RENDER_VALIDATION — NOT READY_TO_SUBMIT.

---

## PHYSICAL PAGE STATUS TERMINOLOGY: PASS

Corrected terminology everywhere:
- Response Components: PASS
- Page Constraint Propagation: PASS
- Physical Page Compliance: **RENDER_VALIDATION_REQUIRED** (not implied verified)

No invented word-to-page conversion (e.g., "500 words = 1 page") exists anywhere.

---

## DETERMINISTIC POST-FINAL VALIDATION: PASS

`src/lib/output/post-final-checks.ts` runs code-only checks:
- response count vs expected
- empty response detection
- word/character counts (analytics)
- markdown detection
- No additional AI call

---

## FIXTURES: 25/25 PASS (A–N)

| Test | Result |
|---|---|
| A. Single SOP → 1 response | PASS |
| B. 1 doc / 2 components → 2 responses | PASS |
| C. 3 short answers → 3 responses | PASS |
| D. Personal Statement preserved | PASS |
| E. No faculty requirement works | PASS |
| F. Generic approved faculty works | PASS |
| G. Different university faculty works | PASS |
| H. Unsupported software → INVENTED_FACT | PASS |
| I. Narrative from evidence → INTERPRETIVE_ELABORATION | PASS |
| J. 3→6 months → ALTERED_FACT | PASS |
| K. Invented fact → REVIEW_REQUIRED | PASS |
| L. Clean + page constraint → READY_FOR_RENDER_VALIDATION | PASS |
| M. Clean + no page constraint → READY_TO_SUBMIT | PASS |
| N. Harvard regression → blocked before pipeline | PASS |

### Full Regression Suites

| Suite | Result |
|---|---|
| Generic Pipeline Tests (A-N) | 25/25 |
| MIT Preflight Tests | 32/32 |
| Faculty Alignment Tests | 45/45 |
| Faculty Approval Tests | 45/45 |
| Generation Contract Fixtures | 19/19 |
| AI Policy Fixtures | 15/15 |
| **Total** | **181/181** |

---

## LIVE OPENAI WRITING CALLS: 0

No Planner/Writer/reviewer/Finalizer calls were made in this phase. All tests are deterministic.

---

## PRESERVED BASELINE

All SOP-AI-7 historical artifacts remain untouched:

```
/opt/sop-ai-app/logs/live-generations/mit-cee-meng-fall-2027-001/
(unchanged; audit correction record added alongside, not altering originals)
```

---

## PRODUCTION IMPACT

| Field | Value |
|---|---|
| PM2 frontend BEFORE | 4680 |
| PM2 frontend AFTER | (see post-check) |
| SOP app | online |
| Live OpenAI writing calls | 0 |
| Production services (D-Vivid) | untouched |
