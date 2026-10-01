# TEST COVERAGE GAPS

**Current suite:** 17 files under `tests/` — 14 PASS / 3 FAIL (baseline
below). All deterministic, 0 paid calls. No lint configured.

| SUBSYSTEM | UNIT | INTEGRATION | REGRESSION | PROD-SAFE SMOKE | GAP |
|---|---|---|---|---|---|
| CV upload route | none | none | none | none | **empty-parse→success untested; dedup engine-gate untested** |
| CV docling mapper | none | none | none | none | **P0 gap — no block-fixture tests at all** |
| cv-sanity | none | none | none | none | rules untested |
| cv-apply/merge | none | none | none | none | identity-conflict path untested |
| docx-validator | none | none | none | none | zip-bomb/magic-byte paths untested |
| generation pipeline | orchestration-invariants, phase-21-retry, phase-16*, phase-19, phase-24, phase-26 | pipeline-level partial | — | — | **stage-6-retry no-repay invariant untested end-to-end; STAGE_TIMEOUT recovery untested; CONTENT_JSON_INVALID regression missing** |
| prompt resolution | document-requirements-scope, document-prompt-ui, resolved-requirements-display**(FAILING — stale)** | — | visa-template-reresolution | — | legacy-flag matrix incomplete |
| documents | document-delete, multi-document, document-evidence-policy | — | — | — | doc create→generate smoke absent |
| intake | none | none | none | none | no section-completion logic tests |
| export | none | none | none | none | pdf-lib/docx outputs untested |
| render validation | none | none | none | none | puppeteer path untested + not covered in CI |
| requirements resolver | — | — | — | — | silent-fetch failures untested |
| auth/rate limit | — | — | — | — | bypass mode not pinned by test |
| phase-17 golden contract | **FAILING — fixture drift** (`projectClarifications` absent from approved contract JSON) | — | — | — | golden files mutable, no hash/ownership check |
| phase-12b | **FAILING — runner** (top-level await under tsx CJS) | — | — | — | test harness inconsistency across suite |

## FAILING BASELINE

| TEST | CAUSE | CLASS |
|---|---|---|
| `resolved-requirements-display.test.ts` | test predates `useLegacyRequirements`; doc fixture lacks flag → new-doc path → `undefined` limits | stale contract — fix test + add flag-matrix cases |
| `phase-17-student-clarification-approval.test.ts` | golden `generation-contract-approved.json` lacks `projectClarifications` — fixture overwritten by later run | **golden-governance gap (P2)** |
| `phase-12b-runner-mock.test.ts` | `ERR_REQUIRE_ASYNC_MODULE` — tsx CJS transform rejects top-level await used only in this file | harness/tooling |

## FAILURES THAT REACHED PROD BECAUSE NO TEST EXISTED

1. **Table-layout DOCX → empty parse** — zero mapper fixtures exist for block-type variation.
2. **DOCX `page:null` → name never extracted** — name-detection path untested for DOCX.
3. **Empty structured result → `success:true`** — no min-content assertion on parse output.
4. **`STAGE_TIMEOUT:factReviewer`** — no test that stage-6 retry resumes without repaying 1–5 (reuse exists but unverified).
5. **Legacy requirement inheritance regression** — caught late by stale test.
6. **`useLegacyRequirements` omission footgun** — no compile/runtime guard.
7. **655KB DOCX → `DOCLING_UNREADABLE`** — no size/complexity fixture corpus.

## GOLDEN REGRESSION CORPUS (Phase 25)

Add `tests/fixtures/cv/` with DOCX/PDF inputs + expected **structural minimums**:

| FIXTURE | COVERS |
|---|---|
| `simple.docx` (Shivang) | baseline heading-style docx |
| `table.docx` (Khushi) | table layout, `MONTH/YYYY` dates, publications, volunteer, languages |
| `two-col.pdf` | sidebar reading order |
| `academic.pdf` | publications-heavy |
| `healthcare.docx` (Khushi domain) | clerkship/volunteer sections |
| `scanned.pdf` | OCR path / graceful unreadable |
| `oversized.docx` (~655KB) | prod failure class |

Assertions = minimum field presence (≥N education, ≥1 exp w/ dates,
skills non-empty) — **never exact-text matching**. Plus: `parse →
non-empty-or-explicit-failure` invariant test.
