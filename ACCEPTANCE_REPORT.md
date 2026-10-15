# D-VIVID Final CV Parser Accuracy Acceptance Report

**Date:** 2026-10-15  
**Parser Version:** `cv-parser.ts` (commit range including table/section fixes)  
**Stress Pack:** `dvivid_complex_resume_stress_pack` (10 synthetic QA fixtures)  
**Test Harness:** `scripts/extract-ground-truth-and-parse.ts` → `/tmp/cv-acceptance-data.json`

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Files tested | 10 |
| Files with **critical errors** | 7 |
| Files **passing cleanly** | 2 |
| Files **blocked by format** | 1 |
| **STOP recommendation** | **YES — critical field-mapping errors remain. Do NOT deploy.** |

**Critical error categories:**
1. **Education under-extraction** — 6 files missing 1–2 education records each (degree detection fails on B.Sc./B.S./B.Com/Executive MBA/Class X).
2. **Experience merge/collapse** — File 01: two distinct jobs collapsed into one responsibilities field.
3. **Personal data contamination** — File 03: city/country polluted by education text; File 05: name parsed as job title.
4. **Image-only PDF unsupported** — File 08: no OCR path, complete failure.
5. **Publications silently dropped** — File 05: 5 publications not mapped to any output field.

---

## File-by-File Acceptance Table

### 01 — Dense Two-Column Product Analyst (PDF)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Aarav | Aarav | **Correct** | Header text |
| **Personal — lastName** | Mehta | Mehta | **Correct** | Header text |
| **Personal — email** | aarav.mehta.qa@example.test | aarav.mehta.qa@example.tes | **Incorrect** | Truncated final char due to line break in PDF |
| **Personal — phone** | +91 90000 12001 | +91 90000 12001 | **Correct** | |
| **Personal — currentCity** | Pune | Pune | **Correct** | |
| **Education count** | 2 | 2 | **Correct** | |
| **Edu[0] degree** | B.Tech | B.Tech | **Correct** | |
| **Edu[0] institution** | Western Institute of Technology | Information Technology - Western Institute of Technology | **Incorrect** | Institution field contains degree text |
| **Edu[1] degree** | Class XII | Class XII | **Correct** | |
| **Experience count** | 3 | 2 | **MISSING** | **Business Analyst - OrbitWorks merged into Senior Product Analyst responsibilities** |
| **Exp[0] role** | Senior Product Analyst | Senior Product Analyst - Northstar Labs | **Incorrect** | Role contains org name |
| **Exp[1] role** | Operations Analyst | Operations Analyst - Meridian Retail Tech | **Incorrect** | Role contains org name |
| **Projects count** | 2 | 2 | **Correct** | |
| **Certifications count** | 2 | 2 | **Correct** | |

**Processing time:** 14,702 ms (Unstructured OSS route)

---

### 02 — Table-Heavy Program Manager (DOCX)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Nisha | Nisha | **Correct** | |
| **Personal — lastName** | Rao | Rao | **Correct** | |
| **Personal — email** | nisha.rao.qa@example.test | nisha.rao.qa@example.test | **Correct** | |
| **Personal — phone** | +91 90000 12002 | +91 90000 12002 | **Correct** | |
| **Education count** | 2 | 2 | **Correct** | |
| **Experience count** | 3 | 3 | **Correct** | |
| **Projects count** | 3 | 3 | **Correct** | |
| **Certifications count** | 3 | 3 | **Correct** | |

**Processing time:** 270 ms (Mammoth HTML route)  
**Status:** ✅ **PASS** — No critical errors.

---

### 03 — Indian Education Substring Traps (PDF)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Kabir | Kabir | **Correct** | |
| **Personal — lastName** | Shah | Shah | **Correct** | |
| **Personal — currentCity** | Ahmedabad | Diploma | **Incorrect** | Parser extracted "Diploma" from education line instead of "Ahmedabad" from header |
| **Personal — currentCountry** | India | Computer Engineering | **Incorrect** | Parser extracted field of study as country |
| **Education count** | 4 | 4 | **Correct** | |
| **Edu[0] degree** | B.Tech | B.Tech | **Correct** | |
| **Edu[1] degree** | Diploma | Diploma | **Correct** | |
| **Edu[2] degree** | Class XII | Class XII | **Correct** | |
| **Edu[3] degree** | Class X | *(empty)* | **Incorrect** | Degree field empty; institution = "Class X - Nirman High School..." |
| **Experience count** | 0 | 0 | **Correct** | |
| **Projects count** | 6 | 6 | **Correct** | |
| **Must-not-create items** | None in wrong sections | All in Projects | **Correct** | Time-series, Debentures, etc. correctly classified as projects |

**Processing time:** 6,828 ms (Unstructured OSS route)

---

### 04 — Senior Executive Multi-Role (PDF)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Elena | Elena | **Correct** | |
| **Personal — lastName** | Martin | Martin | **Correct** | |
| **Personal — phone** | +44 7700 900004 | *(empty)* | **Missing** | Not detected |
| **Education count** | 3 | 1 | **MISSING** | **Executive MBA and B.Sc. not detected** |
| **Edu[0] degree** | M.Sc. | M.Sc. | **Correct** | |
| **Edu[0] institution** | University of Warwickshire | M.Sc. Operations Research - University of Warwickshire | **Incorrect** | Institution field contains degree text |
| **Experience count** | 5 | 5 | **Correct** | |
| **Exp roles** | Clean | All contain "- OrgName" | **Incorrect** | Role field contaminated with org name |
| **Projects count** | 4 | 4 | **Correct** | |
| **Certifications count** | 2 | 2 | **Correct** | |

**Processing time:** 7,099 ms (Unstructured OSS route)

---

### 05 — Academic Research CV (DOCX)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Ishita | Research | **Incorrect** | Parsed as "Research" from line "Research Scientist \| Computational Biology" |
| **Personal — lastName** | Sen | Scientist | **Incorrect** | Parsed as "Scientist" from same line |
| **Personal — email** | ishita.sen.qa@example.test | ishita.sen.qa@example.test | **Correct** | |
| **Education count** | 4 | 3 | **MISSING** | **B.Sc. Life Sciences — Presidency College of Science | 2010 not detected** |
| **Edu[0] degree** | Ph.D. | Ph.D. | **Correct** | |
| **Edu[1] degree** | M.Tech | M.Tech | **Correct** | |
| **Edu[2] degree** | M.Sc. | M.Sc. | **Correct** | |
| **Edu[3] degree** | B.Sc. | *(empty)* | **Missing** | Entire record absent |
| **Experience count** | 3 | 3 | **Correct** | |
| **Publications count** | 5 | 0 | **MISSING** | **Publications section not mapped to any output field** |
| **Certifications count** | 0 | 0 | **Correct** | |
| **Achievements** | Grants/Awards | 3 items | **Partial** | Grants correctly captured as achievements, but publications lost |

**Processing time:** 114 ms (Mammoth HTML route)

---

### 06 — No Education Content Designer (PDF)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Maya | Maya | **Correct** | |
| **Personal — lastName** | Lee | Lee | **Correct** | |
| **Personal — phone** | *(not provided)* | *(empty)* | **Correct** | No false positive |
| **Education count** | 0 | 0 | **Correct** | No false education created |
| **Experience count** | 3 | 3 | **Correct** | |
| **Projects count** | 3 | 3 | **Correct** | |
| **Certifications count** | 2 | 2 | **Correct** | |

**Processing time:** 7,077 ms (Unstructured OSS route)  
**Status:** ✅ **PASS** — Zero-education precision achieved.

---

### 07 — Unusual Headings Cybersecurity (DOCX)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Omar | Omar | **Correct** | |
| **Personal — lastName** | Haddad | Haddad | **Correct** | |
| **Personal — phone** | +971 50 000 1007 | *(empty)* | **Missing** | Not detected |
| **Education count** | 2 | 2 | **Correct** | |
| **Edu[0] degree** | M.Sc. | M.Sc. | **Correct** | |
| **Edu[0] startYear** | 2021 | 2017 | **Incorrect** | Cross-contaminated with B.Sc. dates |
| **Edu[0] endYear** | 2023 | 2021 | **Incorrect** | Cross-contaminated with B.Sc. dates |
| **Edu[1] degree** | B.Sc. | *(empty)* | **Incorrect** | Degree field empty; institution contains full line |
| **Experience count** | 4 | 4 | **Correct** | |
| **Projects count** | 2 | 2 | **Correct** | |
| **Certifications count** | 2 | 2 | **Correct** | |

**Processing time:** 79 ms (Mammoth HTML route)

---

### 08 — Scanned Image-Only Quality Engineer (PDF)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **All fields** | 2 edu, 2 exp, 2 proj, 2 cert | *(none)* | **BLOCKED** | `IMAGE_ONLY_PDF` error — no OCR pipeline available |

**Processing time:** 3,428 ms → error  
**Status:** ❌ **UNSUPPORTED FORMAT** — Parser explicitly rejects image-only PDFs. OCR not configured.

---

### 09 — Mixed Text/Scan Solutions Architect (PDF)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Daniel | Daniel | **Correct** | |
| **Personal — lastName** | Kim | Kim | **Correct** | |
| **Personal — phone** | *(not in extractable text)* | *(empty)* | **Missing** | OCR page did not yield phone |
| **Education count** | 2 | 2 | **Correct** | |
| **Edu[0] degree** | M.S. | M.S. | **Correct** | |
| **Edu[1] degree** | B.S. | *(empty)* | **Incorrect** | Same pattern: B.S. degree field empty |
| **Experience count** | 3 | 3 | **Correct** | |
| **Certifications count** | 2 | 2 | **Correct** | |

**Processing time:** 7,880 ms (Mixed native + OCR route)  
**Note:** Route correctly identified page 2 needed OCR. OCR extracted education text successfully but degree field parsing still failed for B.S.

---

### 10 — Repeated Header/Footer Product Ops (DOCX)

| Field | Expected | Actual | Status | Evidence / Issue |
|-------|----------|--------|--------|----------------|
| **Personal — firstName** | Priya | Priya | **Correct** | |
| **Personal — lastName** | Nair | Nair | **Correct** | |
| **Personal — phone** | +91 90000 12010 | +91 90000 12010 | **Correct** | |
| **Education count** | 2 | 1 | **MISSING** | **B.Com Finance — Cochin City College | 2016 not detected** |
| **Edu[0] degree** | PG Diploma | PG Diploma | **Correct** | |
| **Edu[0] institution** | Kerala School of Digital Business | Product Management - Kerala School of Digital Business | **Incorrect** | Institution field contains degree text |
| **Edu[1] degree** | B.Com | *(empty)* | **Missing** | Entire record absent |
| **Experience count** | 5 | 5 | **Correct** | |
| **Projects count** | 3 | 3 | **Correct** | |
| **Certifications count** | 2 | 2 | **Correct** | |

**Processing time:** 95 ms (Mammoth HTML route)

---

## Cross-File Error Pattern Analysis

### Pattern A: Degree field empty for lower-tier / secondary entries
**Affected files:** 03 (Class X), 07 (B.Sc.), 09 (B.S.), 10 (B.Com), 05 (B.Sc. missing entirely)  
**Root cause:** `parseEducationSection` regex splits on `-` and `|` but fails when the degree token is short (2-3 chars) or when the line lacks a clear delimiter after the institution. For entries after the first in a section, the line-splitting logic may skip or misclassify the degree.  
**Impact:** HIGH — missing or incomplete education records.

### Pattern B: Education records completely dropped after first 1–2 entries
**Affected files:** 04 (2 of 3 missing), 05 (1 of 4 missing), 10 (1 of 2 missing)  
**Root cause:** Section boundary detection terminates early, or line-by-line parser stops when it encounters a line that doesn't match `degreeKeywords` / `institutionKeywords`. Executive MBA (file 04) and B.Com (file 10) may not match the keyword list precisely.  
**Impact:** CRITICAL — entire education records missing.

### Pattern C: Experience entry merge/collapse
**Affected files:** 01  
**Root cause:** `parseExperienceSection` uses paragraph splitting but doesn't recognize "Business Analyst - OrbitWorks | Jan 2022 - Mar 2024 | Bengaluru" as a new job boundary when it follows bullet points from the previous role. The text gets appended to the previous entry's `responsibilities`.  
**Impact:** CRITICAL — job history integrity compromised.

### Pattern D: Role field contaminated with organization name
**Affected files:** 01, 04  
**Root cause:** Experience parser doesn't split "Role - Company" pattern cleanly; the full line text becomes the role.  
**Impact:** MEDIUM — display quality degraded, but count is correct.

### Pattern E: Personal data contaminated by education/experience text
**Affected files:** 03 (city/country), 05 (firstName/lastName)  
**Root cause:** `parsePersonalData` scans the entire document for patterns rather than restricting to the header region. It picks up "Diploma" and "Computer Engineering" from education lines, and "Research Scientist" from the title line under the name.  
**Impact:** HIGH — identity data wrong.

### Pattern F: Image-only PDF unsupported
**Affected files:** 08  
**Root cause:** No OCR pipeline integrated into `parseCVFile`. The parser detects `IMAGE_ONLY_PDF` and aborts.  
**Impact:** HIGH for scanned documents, but explicit failure is safer than silent garbage.

### Pattern G: Publications not mapped
**Affected files:** 05  
**Root cause:** Parser has no `publications` output field. Academic CV sections like "SELECTED PUBLICATIONS" are dropped.  
**Impact:** MEDIUM for academic profiles; feature gap, not a bug.

---

## Count Summary vs Expected

| File | Edu Expected | Edu Actual | Exp Expected | Exp Actual | Proj Expected | Proj Actual | Cert Expected | Cert Actual | Overall |
|------|-------------|------------|--------------|------------|---------------|-------------|---------------|-------------|---------|
| 01 | 2 | 2 ✓ | 3 | 2 ❌ | 2 | 2 ✓ | 2 | 2 ✓ | **FAIL** |
| 02 | 2 | 2 ✓ | 3 | 3 ✓ | 3 | 3 ✓ | 3 | 3 ✓ | **PASS** |
| 03 | 4 | 4 ✓ | 0 | 0 ✓ | 6 | 6 ✓ | 0 | 0 ✓ | **FAIL** (personal) |
| 04 | 3 | 1 ❌ | 5 | 5 ✓ | 4 | 4 ✓ | 2 | 2 ✓ | **FAIL** |
| 05 | 4 | 3 ❌ | 3 | 3 ✓ | — | 0 | 0 | 0 ✓ | **FAIL** |
| 06 | 0 | 0 ✓ | 3 | 3 ✓ | 3 | 3 ✓ | 2 | 2 ✓ | **PASS** |
| 07 | 2 | 2 ✓ | 4 | 4 ✓ | 2 | 2 ✓ | 2 | 2 ✓ | **FAIL** (edu quality) |
| 08 | 2 | 0 ❌ | 2 | 0 ❌ | 2 | 0 ❌ | 2 | 0 ❌ | **FAIL** (unsupported) |
| 09 | 2 | 2 ✓ | 3 | 3 ✓ | — | 0 | 2 | 2 ✓ | **FAIL** (edu quality) |
| 10 | 2 | 1 ❌ | 5 | 5 ✓ | 3 | 3 ✓ | 2 | 2 ✓ | **FAIL** |

**Pass rate: 2/10 (20%)**  
**If excluding image-only PDF (expected limitation): 2/9 (22%)**

---

## Processing Times

| File | Format | Route | Time (ms) | Notes |
|------|--------|-------|-----------|-------|
| 01 | PDF | Unstructured OSS | 14,702 | Dense two-column layout |
| 02 | DOCX | Mammoth HTML | 270 | Table-heavy, 37 tables |
| 03 | PDF | Unstructured OSS | 6,828 | Substring traps |
| 04 | PDF | Unstructured OSS | 7,099 | Multi-page executive |
| 05 | DOCX | Mammoth HTML | 114 | Academic, no complex tables |
| 06 | PDF | Unstructured OSS | 7,077 | No education |
| 07 | DOCX | Mammoth HTML | 79 | Unusual headings |
| 08 | PDF | — | 3,428 | Error: IMAGE_ONLY_PDF |
| 09 | PDF | Mixed native + OCR | 7,880 | Page 2 OCR required |
| 10 | DOCX | Mammoth HTML | 95 | Repeated headers/footers |

**Median PDF time:** ~7,000 ms (Unstructured OSS)  
**Median DOCX time:** ~114 ms (Mammoth HTML)  
**DOCX is ~60× faster than PDF** in this corpus.

---

## Unsupported Layouts (Explicitly Stated)

1. **Image-only / scanned PDFs** — File 08. No OCR pipeline integrated. Parser correctly rejects with `IMAGE_ONLY_PDF` rather than producing garbage.
2. **Academic publications** — File 05. No `publications` field in parser schema. Section is silently dropped.

---

## STOP Recommendation

**Do NOT add more speculative regex fixes.** The remaining errors are structural:

1. **Education under-extraction** is not a regex-tweak problem. The line-by-line keyword scanning in `parseEducationSection` fails when:
   - Multiple education records share a single paragraph/block.
   - Degree keywords (B.Sc., B.Com, Executive MBA) are not in the keyword list or are matched too loosely.
   - The parser stops at the first non-matching line rather than consuming the full section.

2. **Experience merge** (File 01) is a section boundary problem. The parser assumes bullet points always belong to the preceding role, but in dense layouts a new role can start mid-paragraph.

3. **Personal data contamination** (Files 03, 05) requires the parser to restrict personal data extraction to the document header region, not scan globally.

**Recommended next step:** Re-architect education/experience extraction to use section-aware block grouping rather than line-by-line regex. This is beyond the scope of a regex fix and requires parser redesign.

---

## Test Evidence

- Raw parsed output: `/tmp/cv-acceptance-data.json`
- Ground truth expectations: `dvivid_complex_resume_stress_pack/EXPECTED_RESULTS.json`
- This report: `ACCEPTANCE_REPORT.md`

---

*Report generated by automated extraction + manual ground-truth verification.*
