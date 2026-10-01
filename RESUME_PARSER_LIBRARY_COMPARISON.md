# RESUME PARSER — LIBRARY COMPARISON & DECISION

**Context:** D-Vivid Application Writer. Goal is MODEL TESTING, not
high-concurrency production. No OpenAI/LLM resume parsing. Volume is
low (consultant-uploaded, dozens–hundreds of CVs/year).

**Trigger:** `KHUSHI .CV.docx` returned an empty parse while Shivang
and Kunj parsed correctly. Audit found the raw Docling extraction
contained all 13,433 chars / 112 blocks — the data was present, the
custom semantic mapper discarded it because the DOCX is a table-layout
document with no Word heading styles, so Docling emitted zero
`section_header`/`title` blocks and the mapper segmented nothing.

---

## DECISION MATRIX

| CRITERIA | CURRENT: DOCLING + CUSTOM MAPPER | AFFINDA | RCHILLI | DAXTRA |
|---|---|---|---|---|
| **FORMATS** | | | | |
| PDF | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED |
| DOCX | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED |
| Table-based DOCX | PARTIAL — text extracts, but no heading blocks → mapper returns empty | SUPPORTED — layout-agnostic ML model | SUPPORTED | SUPPORTED |
| Two-column PDF | PARTIAL — reading order + sidebar merge bugs seen in mapper | SUPPORTED | SUPPORTED | SUPPORTED |
| Scanned PDF / OCR | PARTIAL — OCR retry exists (PDF only); accuracy unverified | SUPPORTED — image files accepted | SUPPORTED | SUPPORTED — image formats listed |
| Other (RTF/ODT/TXT/HTML) | TXT only | SUPPORTED (all listed) | SUPPORTED | SUPPORTED (widest list incl. doc/xls/ppt/pages/eml/zip) |
| **FIELD COVERAGE** | | | | |
| Personal/contact | PARTIAL — email/phone/linkedin ok; name detection broken for DOCX (`page===1` gate) | SUPPORTED — name/location/nationalities/dob | SUPPORTED — 140+ fields w/ confidence scores | SUPPORTED — 150+ fields |
| Work history | PARTIAL — org-first patterns only; misses date/role order variants | SUPPORTED — title/org/dates w/ precision + current flag + employmentType | SUPPORTED — SegregatedExperience + confidence | SUPPORTED |
| Education | PARTIAL — needs title-type entry openers; drops 12th/10th style records | SUPPORTED — institution/level/fieldsOfStudy/grade/dates | SUPPORTED | SUPPORTED |
| Projects | PARTIAL | SUPPORTED — `projects` array | SUPPORTED — ProjectName/TeamSize/UsedSkills | SUPPORTED — Project History |
| Skills | PARTIAL — label-colon pattern; bare lists partially handled | SUPPORTED — taxonomy (isLanguage/isSoftware/type) | SUPPORTED — ontology + proficiency + LastUsed | SUPPORTED |
| Certifications | PARTIAL | SUPPORTED — name/issuer/date | SUPPORTED — SegregatedCertification | SUPPORTED |
| Achievements | PARTIAL | SUPPORTED — `achievements` | SUPPORTED — AwardTitle/Issuer | SUPPORTED |
| Research/Publications | NOT SUPPORTED — no schema slot, no section keyword | SUPPORTED — `publications`/`patents` | SUPPORTED — SegregatedPublication (title/publisher/authors/URL) | SUPPORTED |
| Languages | PARTIAL — routed to warnings only | SUPPORTED — `languages` + skill taxonomy flag | SUPPORTED | SUPPORTED — 40+ languages |
| Volunteer work | NOT SUPPORTED — no section keyword | PARTIAL — lands in associations/other sections | PARTIAL | PARTIAL |
| Dates | PARTIAL — `Month YYYY`/`YYYY` only; fails `JULY/2022`, embedded dates | SUPPORTED — normalized dates + precision | SUPPORTED — normalized JobPeriod | SUPPORTED |
| Confidence/quality metadata | PARTIAL — own coarse HIGH/MED/LOW only | SUPPORTED — `meta.document.extractionQuality` + classification confidence | SUPPORTED — per-field ConfidenceScore | SUPPORTED |
| Stable JSON schema | N/A — own schema | SUPPORTED — versioned (`schemaVersion`), sparse-doc contract | SUPPORTED — versioned API (8.0.0) | SUPPORTED — versioned DaxJson/HR-XML |
| **DEPLOYMENT & INTEGRATION** | | | | |
| Self-hosting | SUPPORTED — already running (uvicorn sidecar) | SUPPORTED — `affinda/resume-parser` Docker, same JSON | SUPPORTED — on-premise option | SUPPORTED — on-premise or hosted |
| Cloud API | N/A | SUPPORTED — self-serve, API key | SUPPORTED | SUPPORTED |
| Data privacy | SUPPORTED — fully local today | PARTIAL — cloud is stateless (no retention claimed) but PII leaves infra; self-host solves it | PARTIAL — same trade-off | PARTIAL — same trade-off |
| TS/HTTP integration | SUPPORTED — in place | SUPPORTED — single POST multipart → JSON; TS quickstart exists | SUPPORTED — POST base64 JSON | PARTIAL — REST or SOAP, account-param conventions, heavier |
| Integration complexity | N/A (exists) | LOW — one endpoint, thin canonical mapper needed | MEDIUM — userkey/subuserid contract | MEDIUM-HIGH — enterprise integration surface |
| Cost model | SUPPORTED — infra only | SUPPORTED — $0.10/doc self-serve (trial: 1,000 docs); self-hosted license from ~$12k/yr | UNKNOWN — contract/sales pricing | UNKNOWN — enterprise sales pricing |
| Vendor lock-in | NONE | PARTIAL — schema-specific but mapping is thin | PARTIAL | PARTIAL — deeper enterprise coupling |
| **FIT FOR "MODEL TESTING" PHASE** | | | | |
| Fixes Khushi-class failures | NO (root cause) | YES | YES | YES |
| Time-to-working | — | LOW — trial key → POST file | MEDIUM — sales contact needed | HIGH — sales + integration |
| Maintenance burden | HIGH — regex/state machine grows per format | LOW — vendor owns parsing | LOW | LOW |

---

## VERDICT

| Option | Verdict |
|---|---|
| Swap Docling → python-docx / Tika / Unstructured | **NO** — all text was already extracted. The gap is resume semantics, not text extraction. A different generic extractor produces the same untyped lines for this DOCX. |
| Keep Docling + patch mapper for Khushi | **PARTIAL** — fixes this file (text-block heading detection, `MM/YYYY` dates, new section keywords, table dedup) but leaves the architecture as a hand-grown resume parser that breaks on the next format. |
| Purpose-built resume parser | **YES — AFFINDA** — only candidate verified to cover all required fields incl. publications/achievements/languages, with extraction-quality metadata, trivial HTTP/TS integration, self-serve trial, and a self-hosted path for data privacy later. |

## NOTES

- **Affinda self-hosted license (~$12k/yr floor)** is disproportionate for
  model-testing volume — use the **cloud API at $0.10/doc** during testing
  (stateless, no retention per their docs), revisit self-hosting only if
  the platform reaches real production volume or a hard data-residency
  requirement appears.
- RChilli is the closest runner-up: deepest per-field confidence +
  publications/projects schema, but contract-gated access and no
  published self-serve tier slow down evaluation.
- Daxtra is enterprise-grade (SOAP/REST, HR-XML, batch monitoring) —
  capability is not in doubt, but integration weight and pricing model
  are mismatched to a testing-phase consultant tool.
