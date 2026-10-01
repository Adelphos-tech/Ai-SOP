# CV IMPORT ROOT-CAUSE AUDIT

## 1. PRODUCTION PIPELINE — verified actual behavior

DOCX order: **Mammoth semantic → Docling mapper → raw-text → hard-fail**
PDF order: **Docling mapper → legacy pipeline → raw-text → hard-fail**

Verified in `src/lib/application/resume-import/index.ts` —
`resumeImportStrategiesFor(ext)` returns ordered `StrategyDescriptor`s; the
orchestrator iterates, applies per-strategy timeout (`withTimeout`),
computes coverage per candidate, early-exits at `coverage === GOOD`,
otherwise keeps all candidates and selects `selectBestCandidate`.

This matches the intended design. Deviations found below.

## 2. KHUSHI CLASSES — two distinct bugs, audited separately

### A. Small Khushi DOCX — Docling extracted, mapper produced nothing

| Fact | Evidence |
|---|---|
| File structure | standard DOCX, extractable text |
| Docling extraction | 112 blocks — text present, BUT zero `section_header` blocks |
| Mapper outcome | mapDoclingBlocks requires section_header to open sections → all blocks orphaned → empty structural map |
| Mammoth outcome | name + 5 education + 5 certs — full parse |
| Root cause | CONFIRMED: mapper's section-gated design cannot parse block sequences without headers — an ARCHITECTURAL mapper limitation, not an extraction bug |
| Disposition | mitigated by DOCX ordering (mammoth first); Docling now redundant *for this class* but still first-choice for PDF |

### B. 655KB Khushi-like DOCX — Docling extraction itself failed

| Fact | Evidence |
|---|---|
| File | large, media-heavy DOCX |
| Docling | extraction error/timeout class — no blocks produced |
| Mammoth | unaffected (XML-level, no structure dependency) |
| Root cause | PARTIAL: sidecar timeout/memory under large media payload — exact failure mode (process kill vs response error) not captured in retained logs |
| Disposition | ordering already covers it; CV-003 (no abort propagation) means the dead sidecar call still burns CPU |

**They are not the same bug:** A = extraction succeeds/mapping fails;
B = extraction fails. Different mechanisms, shared mitigation.

## 3. IMAGE-ONLY DOCX (Kunj) — confirmed structure

`document.xml` contains 0 text runs + 6 `w:drawing` image embeds.
Genuinely image-only — every text strategy correctly hard-fails.
`FAILED_FILE` → consultant sees controlled failure. This is a **feature
gap** (no OCR), not a defect. Free OCR comparison in
FREE_LIBRARY_REPLACEMENT_AUDIT.md §OCR.

## 4. COVERAGE CLASSIFICATION — deterministic rules verified

From `coverage.ts` `computeCoverage`:

| State | Exact rule |
|---|---|
| GOOD | required sections present + personal (name/email/phone) + ≥3 usable sections |
| PARTIAL | some required sections missing OR sparse items |
| EXTRACTION_ONLY | text extracted but no usable structure |
| UNREADABLE | no usable text |

False-positive/negative analysis:

| Case | Expected | Actual | Verdict |
|---|---|---|---|
| very short fresher CV | PARTIAL/GOOD | PARTIAL if ≥1 section + name | PASS |
| no work experience | PARTIAL | PARTIAL (not UNREADABLE — education/skills count) | PASS |
| no skills heading | PARTIAL | PARTIAL | PASS |
| academic CV | GOOD/PARTIAL | works if headings detectable | PASS |
| all-table resume | varies | table text flows into section detection for mammoth; docling blocks lack headers → EXTRACTION_ONLY risk | KNOWN EDGE |
| sidebar layout | varies | reading order may scramble; extraction ok, structure risky | EDGE |
| image-only | UNREADABLE | UNREADABLE → FAILED_FILE | PASS |

Sparse-but-valid resumes are NOT classified unreadable — required gates are
appropriately minimal.

## 5. STRATEGY RANKING — "more fields ≠ better" (CV-004)

`coverageRank`: `tier·1_000_000 + sectionCount·10_000 + ΣitemCounts·100 +
personal·10` — **raw volume wins within a tier**.

Confirmed vulnerability: an over-parsing strategy producing 21 phantom
education entries outranks a correct 2-entry parse in the same coverage
tier. Cross-tier ordering is safe (tier dominates), so the over-parsed
PARTIAL only wins over a clean PARTIAL/EXTRACTION_ONLY.

Ranking does NOT currently check: plausibility, duplicate tuples, section
coherence, contact validity, date ordering. Per spec, no AI judging —
deterministic plausibility heuristics (dedup, cap-check) are the fix class.

## 6. CV APPLY / MERGE — traced end-to-end

parsed → `cv-apply` route → consultant preview/edit → apply → merge policy
→ `saveStudentProfile` (revision-conditional when provided).

| Requirement | Status |
|---|---|
| low-confidence can't silently overwrite | PASS — `overwrite` flag explicit; provenance diff computed |
| identity conflict enforced | PASS — checkIdentityConflicts (name/dob mismatch → blocked) |
| partial parse provenance retained | PARTIAL — cv-* ids on education/experience/projects/achievements only; **skills merge has no provenance** (CV-006) |
| extraction-only cannot auto-apply | PASS — apply requires mapped structure |
| duplicates controlled | PARTIAL — exact-match dedup; near-dupes survive (CV-008) |
| re-upload replacement deterministic | PASS — replaceCvDerived strips cv-* ids, re-applies; skills blind spot noted |

## 7. UPLOAD ROUTE — hardening verified

Content-Length early-reject → 10MB cap → magic bytes (%PDF / DOCX ZIP
structure + zip-bomb via validateDocx) → SHA-256 dedup w/ engine+version
pinning → cvParseLimiter concurrency bound → importResume → controlled
error codes (CV_FILE_INVALID / CV_EXTRACTION_EMPTY / CV_PARSE_BUSY / …).

No temp-file leaks found (in-memory buffers; stored original kept by hash).
Stale parse reuse is pinned to pipeline version — a chain change re-parses.

## 8. RESIDUAL ISSUES SUMMARY

| ID | Issue | Severity |
|---|---|---|
| CV-001 | docling mapper section-header dependency | mitigated; root open |
| CV-002 | legacy PDF over-segmentation | mitigated; fallback-risk remains |
| CV-003 | withTimeout no abort propagation | resource leak, low |
| CV-004 | count-weighted ranking favors over-parse | medium |
| CV-005 | no OCR path (image-only docs) | feature gap |
| CV-006 | skills merge lacks provenance | medium |
| CV-007 | revision-unconditional profile save fallback | medium |
| CV-008 | exact-match dedup only | low |
