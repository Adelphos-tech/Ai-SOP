# GENERATION STRICTNESS AUDIT

**Date:** 2026-09-20 · Audited: every fatal path in the 6-stage generation path

## Rule inventory

| # | Rule | File:site | Stage | Type | Was fatal | After normalization |
|---|---|---|---|---|---|---|
| 1 | GENERATION_CONTRACT_REQUIRED | pipeline:599 | pre | A technical | YES | **FATAL** |
| 2 | INVALID_GENERATION_ID | pipeline:626 | pre | A technical | YES | **FATAL** |
| 3 | STAGE_EXECUTION_INIT_FAILED | pipeline:670 | exec | A technical | YES | **FATAL** |
| 4 | EMPTY_CONTENT / CONTENT_JSON_INVALID / CONTENT_SCHEMA_INVALID | stage-execution | per-stage | A technical (after retries) | YES | **FATAL** |
| 5 | PROVIDER_* / STAGE_TIMEOUT / GENERATION_TIME_LIMIT | pipeline:479-570 | per-stage | A technical | YES | **FATAL** |
| 6 | Pre-gate MISSING_REQUIRED_STUDENT_INFORMATION | pipeline:765 | pre | C content | YES | **FATAL only when zero student facts exist; else WARNING (TOPIC_EVIDENCE_UNCERTAIN)** |
| 7 | WRITER_EVIDENCE_REFERENCE_VIOLATION | pipeline:857 | post-Writer | B/C | YES | **WARNING** — Fact Reviewer audits final claims |
| 8 | QUALITY_REVIEWER_OUTPUT_INVALID | pipeline:909 | post-QR | C | YES | **WARNING** — action planner degrades to FREEZE |
| 9 | LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM | pipeline:966 | post-LC | B safety | YES | **WARNING + fallback to Writer text** (no unsafe text kept) |
| 10 | actionPlan.blocked — FINALIZER_SCOPE_VIOLATION (no calibrated text) | pipeline:1020 | post-LC | A technical | YES | **FATAL** — no draft exists |
| 11 | actionPlan.blocked — MISSING_REQUIRED_STUDENT_INFORMATION / REQUIRED_TOPIC_COVERAGE_UNKNOWN / FINALIZER_EVIDENCE_VIOLATION / RENDER_VALIDATION_REQUIRED | pipeline:1010-1020 | post-LC | C content | YES | **WARNING** |
| 12 | checkMissingMandatoryTopics → MISSING_REQUIRED_STUDENT_INFORMATION | pipeline:1040 | post-LC | C content | YES | **WARNING (TOPIC_EVIDENCE_MISSING)** — even official topics: no fabrication, warn instead |
| 13 | BOUNDED_FINALIZER_BLOCKED | pipeline:1055 | Finalizer | B/C | YES | **WARNING + calibrated-text fallback** |
| 14 | FINALIZER_METADATA_INCOMPLETE (retries exhausted) | pipeline:1120 | Finalizer | C | YES | **WARNING + fallback** |
| 15 | FINALIZER_EXECUTION_FAILED (provider/transport) | retry loop | Finalizer | A technical | YES | **FATAL** (propagates) |
| 16 | FINALIZER_GUARD_FAILED | pipeline:1197 | Finalizer | B/C | YES | **WARNING + calibrated-text fallback + re-render** |
| 17 | FINALIZER_GUARD_INCOMPLETE | pipeline:1209 | Finalizer | C | YES (throw) | **WARNING + fallback** |
| 18 | CLAIM_PROVENANCE_VIOLATION | pipeline:1231 | Finalizer | B | YES | **WARNING + fallback** |
| 19 | FACT_REVIEWER_OUTPUT_INVALID | pipeline:1271 | FactRev | A technical | YES | **FATAL** |
| 20 | EMPTY_FINAL_DOCUMENT (new) | pipeline:1155 | post-Finalizer | A technical | — | **FATAL** (no usable draft) |
| 21 | Page/word/format deviations | post-checks | post | C/D | advisory already | WARNING codes added |
| 22 | FACT_REVIEW flags | pipeline | post | B | advisory | WARNING (FACT_REVIEW_WARNING) |
| 23 | GENERATION_BLOCKED (context: profile missing/LOR/Visa/fact-sheet) | generation-context:188-223 | pre | A/B minimum-data | YES | **FATAL** (legit minimum-data gates) |

## Totals

- Rules audited: **23** (+ provider/parse variants)
- Fatal before: **~15**
- Fatal after: **8** — all technical/data-integrity (contract missing, invalid IDs, stage exec init, provider/parse failures after retries, zero-evidence, no calibrated text, invalid FR output, empty final document)
- Converted to warning: **7** (pre-gate topics, writer evidence refs, QR invalid, missing mandatory topics, page/word/fact-review advisory codes)
- Converted to repair+fallback+warning: **5** (LC new claims → Writer text; finalizer blocked/metadata/guard/provenance → calibrated text)

GENERATION POLICY NORMALIZED — QUALITY ISSUES WARN, TECHNICAL FAILURES BLOCK
