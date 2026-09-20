# FINAL GENERATION NORMALIZATION AUDIT

**Date:** 2026-09-20 · **OpenAI calls:** 0 · **Generations:** 0

## Exhaustive exit-path inventory

### A. Pre-pipeline (generation-service + route + context)

| Code | Site | Terminates? | Class | Safe draft? | Behavior |
|---|---|---|---|---|---|
| auth failure | route.ts:50 | yes, pre-run | A technical | n/a | FATAL (401/403) |
| missing IDs | route.ts:59 | yes | A technical | n/a | FATAL (400) |
| context load failure | service:112 | yes | A technical | n/a | FATAL |
| FACT_SHEET_NOT_APPROVED | context:192 | yes | A policy gate | n/a | FATAL — consultant must approve facts first (intentional product gate) |
| MISSING_REQUIRED_STUDENT_INFORMATION (LOR recommender) | context:201 | yes | B minimum-data | n/a | FATAL — LOR cannot be truthfully drafted without any recommender context |
| MISSING_REQUIRED_STUDENT_INFORMATION (visa evidence) | context:210 | yes | B minimum-data | n/a | FATAL — visa SOP without rationale/ties evidence cannot be drafted safely |
| MISSING_REQUIRED_STUDENT_INFORMATION (no meaningful data / no profile) | context:219/222 | yes | B minimum-data | n/a | FATAL — NO usable data, not partial data |
| OPENAI_API_KEY_REQUIRED | service:130 | yes | A technical | n/a | FATAL (503) |
| AI_SERVICE_TEMPORARILY_UNAVAILABLE (circuit) | service:170 | yes | A technical | n/a | FATAL (503, transient) |
| GENERATION_ALREADY_IN_PROGRESS | service:186 | yes | A concurrency | n/a | FATAL (409 — caller retries) |
| uncaught error | route:91 → releaseGenerationLock → FAILED | yes | A technical | n/a | FATAL (500) |

### B. Pipeline internals (run-application-pipeline + stage-execution)

| Code | Site | Terminates? | Class | Safe draft? | Behavior |
|---|---|---|---|---|---|
| GENERATION_CONTRACT_REQUIRED | pipeline:599 | yes | A | n/a | FATAL |
| INVALID_GENERATION_ID | pipeline:626 | yes | A | n/a | FATAL |
| STAGE_EXECUTION_INIT_FAILED / exec-init codes | pipeline:670-672 | yes | A | n/a | FATAL |
| MISSING_REQUIRED_STUDENT_INFORMATION (zero student evidence) | pipeline:765 | yes | B→A | n/a | FATAL only when NO usable evidence; per-topic gaps → WARNING |
| WRITER_EVIDENCE_REFERENCE_VIOLATION | pipeline:857 | no | C | yes | WARNING |
| QUALITY_REVIEWER_OUTPUT_INVALID | pipeline:909 | no | C | Writer text | WARNING |
| LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM | pipeline:966 | no | B | Writer text | SAFE_FALLBACK → Writer text + warning |
| actionPlan FINALIZER_SCOPE_VIOLATION (no calibrated text) | pipeline:1020 | yes | A | no | FATAL — no draft exists |
| actionPlan semantic issues (topic/evidence/render) | pipeline:1010 | no | C | calibrated text | WARNING |
| checkMissingMandatoryTopics | pipeline:1040 | no | C | calibrated text | WARNING (TOPIC_EVIDENCE_MISSING) |
| BOUNDED_FINALIZER_BLOCKED | pipeline:1055 | no | C | calibrated text | SAFE_FALLBACK + warning + cursor skip() |
| FINALIZER_METADATA_INCOMPLETE (retries exhausted) | pipeline:1120 | no | C | calibrated text | SAFE_FALLBACK + warning |
| FINALIZER_EXECUTION_FAILED (provider) | retry loop rethrow | yes | A | calibrated text exists but provider failure is technical | FATAL (propagates) |
| EMPTY_FINAL_DOCUMENT | pipeline:1181 | yes | A | no | FATAL — no usable text |
| FINALIZER_GUARD_FAILED / GUARD_INCOMPLETE / CLAIM_PROVENANCE_VIOLATION | pipeline:1197-1231 | no | B/C | calibrated text | SAFE_FALLBACK + warning + re-render |
| FACT_REVIEWER_OUTPUT_INVALID | pipeline:1301 | yes | A | final text | FATAL — unparseable required stage output |
| EMPTY_CONTENT / CONTENT_JSON_INVALID / CONTENT_SCHEMA_INVALID / AI_STAGE_SCHEMA_INVALID | stage-execution:138-156 | yes (after retries) | A | prior stage text | FATAL |
| PROVIDER_* / STAGE_TIMEOUT / GENERATION_TIME_LIMIT / POLL_FAILED | pipeline:479-570 | yes | A | prior stage | FATAL |
| STAGE_ORDER_VIOLATION / ATTEMPT_LOCKED / EXECUTION_CLOSED / RUN_NOT_ACTIVE / BUSY | stage-execution:379-505 | yes | A | n/a | FATAL |
| CHECKPOINT_INTEGRITY_FAILED / STALE_CHECKPOINT_REJECTED / TECHNICAL_RETRY_* / MISSING_DEPENDENCY_HASH / INVALID_* | stage-execution:221-364 | yes | A | n/a | FATAL |
| post-final checks / page / word / fact-review flags | pipeline:1361-1376 | no | C/D | final text | WARNING codes |

## Counts

- TOTAL RUNTIME EXIT PATHS: **34** (+ issue() codes inside validators)
- TECHNICAL/DATA FATALS: **18**
- CONTENT FATALS: **0**
- QUALITY FATALS: **0**
- COMPLIANCE FATALS: **0**
- SAFE FALLBACK PATHS: **4** (LC→Writer text; finalizer plan/metadata/guard/provenance→calibrated text)
- WARNING PATHS: **11**

## §4 Minimum-data gates — all justified

Fatal only when the document type cannot be truthfully drafted: unapproved fact sheet (product gate), zero recommender context (LOR), zero visa evidence (visa SOP), zero meaningful profile data, no profile. Partial data — missing GPA, one motivation answer, one project — never blocks (evidence gate warns per-topic).

## §5 Safe-draft preservation — verified

QR unusable → Writer text. LC unsafe → Writer text. Finalizer plan/metadata/guard/provenance failure → calibrated text. Post-final semantic issues → final text. **No nontechnical condition discards all safe text** (EMPTY_FINAL_DOCUMENT fatal only when literally no text exists).

## §6 Fact Reviewer fatal — justified, kept

FR output is the last-stage safety audit of the exact persisted text. Invalid output = technical stage failure (schema/parse) after execStage's internal technical retries. A safe draft exists textually, but shipping an unaudited draft would violate the "deterministic fact review" guarantee the consultants rely on. Retried (metadata-incomplete analog + provider retries); only a definitively malformed audit is fatal. **Recommendation: keep fatal.** Downgrade would trade a technical failure for a silently unaudited draft — the wrong direction for the safety layer.

## §7 skip() semantics — verified by tests

Persists raw + artifact + checkpoint, zero-cost usage (`deterministic-fallback`), cursor +1 exactly once, re-execute on skipped stage → STAGE_ORDER_VIOLATION, replay-safe via checkpoint restore, accounting distinguishes it (model=deterministic-fallback). Warning `BOUNDED_FINALIZER_BLOCKED`/`FINALIZER_METADATA_INCOMPLETE` explains the preserved draft.

## §8 Warning propagation

`generationWarnings[]` → `result.warnings` → `body.warnings` → amber UI card. Never translated to FAILED or errorCode. Document persists `GENERATED` → View/Edit/Save/Approve unaffected (UI only reads warnings to display).

## §10 Regressions

- typecheck: clean · build: clean · CI: green (`4a4a00d`)
- Zero-token preflight: **32/32 PASS**
- Orchestration invariants: **7/7 PASS** (0 provider calls)

## §11 Historical failure matrix

| Past failure | Status |
|---|---|
| MISSING_REQUIRED_STUDENT_INFORMATION (topic gaps) | → warning; fatal only on zero evidence |
| REQUIRED_TOPIC_COVERAGE_UNKNOWN | → warning |
| STAGE_ORDER_VIOLATION from skipped Finalizer | → impossible (skip() advances cursor; tested) |
| wordLimit.min loss / mandatoryTopics loss / additionalQuestions loss | fixed + preflight-verified |
| raw reparse instead of canonical Zod output | fixed |
| consultant instructions / country / motivation / career loss | fixed + preflight-verified |

OPENAI CALLS: 0
DOCUMENT GENERATIONS: 0

GENERATION PIPELINE NORMALIZATION COMPLETE — NO HIDDEN NONTECHNICAL BLOCKERS REMAIN
