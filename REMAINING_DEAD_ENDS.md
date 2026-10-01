# REMAINING DEAD ENDS

States audited for "consultant cannot proceed without developer intervention."

## Resolved this audit

| Former dead end | Was | Now |
|---|---|---|
| Incomplete intake → no "Add Document" button | UI hid the button until all 6 sections complete — a consultant with a sparse applicant could never create a document to configure a prompt | Button always visible; intake remains advisory guidance |
| Incomplete intake → Generate permanently disabled | `disabled={readinessBlocked}` was stricter than the server gate — no consultant override existed | Button enabled; advisory warning; server `GENERATION_BLOCKED` (with reasons) remains authority |

## Confirmed NOT dead ends

| State | Escape path |
|---|---|
| CV parse FAILED_FILE / EXTRACTION_EMPTY | Manual intake forms — always available, no gating |
| OCR failure / limits | Manual intake; retry upload |
| Generation FAILED | "Try Again" / "Retry Generation" buttons on FAILED card |
| Run stuck GENERATING | Heartbeat orphan detection (15s grace) → auto-resume on status poll; stale-PID lock reclaimed |
| Run RECOVERING | Status endpoint auto-resumes the same run; checkpoints/provider responses reused |
| No official prompt discovered | Consultant prompt + default D-Vivid template on every document type |
| Requirement fetch failure | Manual document instructions field |
| FACT_SHEET not approved | Auto-approved once profile has meaningful data (verified 5b) |
| Page-limit violation on FINAL export | Edit content or raise the limit; PREVIEW export unaffected |
| Stale CONFLICT on CV apply | Reload profile, re-apply (diff preserved) |

## Known remaining gaps — RESOLVED (final remediation)

### 1. Mixed image/text DOCX OCR gap (§11) — FIXED

`needsOcrFallback` fired only when best candidate was UNREADABLE or
EXTRACTION_ONLY <40 chars, so a DOCX with ≥40 chars of XML text plus
image-borne content skipped OCR. Now: `docx-image-inspect.ts` reads
`word/media/*` dimensions from format headers (no decode); a document
with ≥1 "content image" (≥500px short side AND ≥400k px — calibrated on
real ~2MP page scans; logos/photos excluded) AND <800 chars live text
AND non-GOOD coverage is classified **image-dominant** → OCR runs.
The OCR output enters as a separate `OCR_TEXT_EXTRACTION` candidate and
the existing plausibility ranking chooses — no text merging. Verified:
57-char XML + 1240×1692 page image fixture → OCR invoked, wins on merit.

**Mixed-PDF note — CLOSED:** Docling's `/parse` retries with
`do_ocr=True` only when fast-path text is ≤10 chars; a mixed PDF with a
real text layer was not re-OCR'd (reproduced: 48-char header extracted,
image-borne resume lost). Now `POST /inspect` on the sidecar reports
per-page image stats via pypdfium2 (`get_px_size` — rendered size, so
small-displayed images stay decorative); a PDF with <800 chars live
text AND ≥1 content-sized image is image-dominant →
`OCR_TEXT_EXTRACTION` candidate joins ranking. Reproduced fixture
`synth-mixed-text-image.pdf` now yields PARSED_WITH_WARNINGS with
image-borne education recovered; `synth-text-plus-logo.pdf` inspects to
0 content images → no OCR.

### 2. CV-apply skills residue (§12) — FIXED

Skills stay `string[]` (schema unchanged); provenance lives in a
companion `profile.skillProvenance[category][normalizedSkill] = importId`
map. `mergeCvSkills`/`removeCvDerivedSkills` (in `cv-merge.ts`): merge
mode appends + normalized-dedupes and tags new skills with the apply's
`cv-*` importId; `replaceCvDerived` drops only `cv-`-tagged skills;
absent provenance = manual = always preserved. Verified by
`tests/cv-skills-provenance.test.ts` (8/8) including the spec scenario:
CV-A {Jira,Figma} + manual "Stakeholder Management" + replace with
CV-B {SQL,Power BI} → {Stakeholder Management, SQL, Power BI}.

### 3. Visa SOP gate vs. canonical intake key coverage

`checkVisaEvidence` reads `careerGoals.longTerm.{homeCountryPlans,vision}`, `countryQuestionnaire`, `mastersMotivation`, and legacy `careerGoals.{whyField,whyProgram,returnHomeCountry,returnPlans}` — all canonical intake shapes covered. Verified working via `context_data`. No gap; documented here because the raw-vs-adapted profile confusion cost a debugging cycle (the check runs on the **resolved** raw intake profile, not the adapted profile — correct behavior).

## Permanent-state audit (§21)

- `RUNNING` runs: recovered via heartbeat/orphan scan ✅
- `RECOVERING` runs: auto-resume ✅
- Deleted-document runs: pipeline checks doc existence per stage (ownership revalidated)
- `is_generating` documents: tied to run status; FAILED runs clear it
- No permanent lock state found — locks carry PIDs and dead-PID reclamation exists
