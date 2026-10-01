# INTENTIONAL HARD BLOCKERS

The deliberately small set of blockers that must remain hard. Each justifies:
why it must block, why a warning is unsafe, and the user's recovery action.

## 1. Unreadable file with no recoverable content (`CV_EXTRACTION_EMPTY` / `FAILED_FILE`)

- **Why it must block:** there is literally no parsed content to review; presenting an empty profile import would silently do nothing.
- **Why warning is unsafe:** a "warning + continue" would import a blank/ghost profile — worse than failing.
- **Recovery:** upload a different file, or use manual intake (always available, never gated).

## 2. OCR resource limits (`CV_OCR_LIMIT_EXCEEDED`)

- **Why it must block:** >10 pages/images or >20M decoded pixels risks exhausting the shared CPU server.
- **Why warning is unsafe:** partially-OCR'd resumes would silently drop pages — invisible data loss.
- **Recovery:** compress/split the file, or manual intake.

## 3. Optimistic-concurrency conflict on profile save (cv-apply CONFLICT)

- **Why it must block:** merging on a stale revision can overwrite a concurrent edit.
- **Why warning is unsafe:** silent lost-update = data corruption.
- **Recovery:** reload and re-apply; diff is preserved.

## 4. Ownership/relationship violations (403s: student→application→document→version)

- **Why it must block:** cross-tenant data access.
- **Why warning is unsafe:** security boundary.
- **Recovery:** use the correct record.

## 5. Document-type evidence gates (LOR recommender, visa evidence) + fact-sheet minimum

- **Why it must block:** the pipeline is evidence-constrained by design; generating a Letter of Recommendation with no recommender, or a Visa SOP with no return-intent evidence, would fabricate.
- **Why warning is unsafe:** fabricated claims in legal/admissions documents are the core harm this product exists to prevent.
- **Recovery:** the 422 returns structured `blockReasons` with direct links to the missing intake section. Note: this is a **minimal** gate — any meaningful profile data passes it; the 6-section intake checklist is advisory.

## 6. Generation ownership / checkpoint integrity (`CHECKPOINT_INTEGRITY_FAILED`, `GENERATION_STATE_PERSISTENCE_FAILED`, `GENERATION_ALREADY_IN_PROGRESS`)

- **Why it must block:** generation ownership and durable checkpoints are the billing/correctness invariants; a duplicate or corrupted run could double-charge or corrupt version history.
- **Why warning is unsafe:** silent state divergence.
- **Recovery:** 409 reconciles to the live run automatically (UI polls and resumes); checkpoint failures start a clean run.

## 7. FINAL export requires approved version + page-limit check

- **Why it must block:** "final" export is the consultant's attestation; page limits are hard university requirements.
- **Why warning is unsafe:** a watermarked-optional product promise; PREVIEW export is always unblocked.
- **Recovery:** approve a version / shorten content.

## Document-type evidence gate revalidation (final remediation §C)

Full inventory of document-specific evidence gates — there are exactly
two, plus two universal minimums:

| Doc type | Gate | Check | Verdict |
|---|---|---|---|
| VISA_SOP | `visaSpecificEvidence` | ANY of: `careerGoals.longTerm.{homeCountryPlans,vision}`, any `countryQuestions` answer, any `mastersMotivation` field, legacy career fields | **JUSTIFIED.** A visa SOP's substance is study rationale + post-study intent. With zero evidence in ANY of four broad fields the pipeline would fabricate finances/ties/intent — the exact harm the evidence-constrained design prevents. The check is permissive (one sentence anywhere unblocks) — it gates absence, not quality. NOT a property/family-ties requirement. |
| LETTER_OF_RECOMMENDATION | `recommenderPerspectiveRequired` | `recommenderContext` OR `recommender` OR any experience entry | **JUSTIFIED.** An LOR is written in a recommender's voice; with zero recommender context AND zero experience, every claim about the relationship is invented. Permissive: one experience entry or one recommender field unblocks. |
| all | `FACT_SHEET_NOT_APPROVED` | profile has any meaningful data → auto-approved | **JUSTIFIED** minimum; verified auto-approves on name+education. |
| all | `MISSING_REQUIRED_STUDENT_INFORMATION` | no profile / no meaningful data at all | **JUSTIFIED** — nothing to write from; manual intake is the escape. |

Subjective-completeness items confirmed to NEVER hard-block: no work
experience (fresher `noWorkExperience` flag), no projects, no research,
career switch, study gap, repeat degree, weak grades, missing
certifications, no property/family ties. Unjustified gates remaining: **0**.

Consultant override path for both doc-type gates: enter the relevant
evidence (one field suffices) — gates are data-availability checks, not
quality judgments, so no override toggle is needed.

## Removed blockers this audit

| Former blocker | Verdict | Action |
|---|---|---|
| "+ Add Document" hidden until 6-section intake complete | C made A — unnecessary; prevented ALL document work on incomplete intake | Ungated; intake remains advisory |
| Generate `disabled` on client-side readiness | C made A — client stricter than its own server gate; no override path | Button enabled; warning advisory; server gate authoritative |
