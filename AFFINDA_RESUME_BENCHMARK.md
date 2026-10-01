# AFFINDA RESUME PARSER — BENCHMARK

**Date:** 2026-09-30 · **Scope:** benchmark only — **no production routing change, 0 profile writes, 0 DB mutations**
**Harness:** `scripts/affinda-benchmark/` (`affinda-client.ts`, `affinda-adapter.ts`, `corpus.ts`, `generate-fixtures.ts`, `run-benchmark.ts`)
**Artifacts:** `test-output/affinda/` (gitignored) — raw vendor JSON per file in `raw/`, full results in `results.json`

---

## 0. STATUS

| Item | State |
|---|---|
| Test-only client (env key, no routing change) | DONE |
| Raw vendor response capture (status, duration, quality meta, schema ver) | DONE — written to ignored artifacts only |
| Canonical adapter Affinda→ResumeCandidate + Zod validation | DONE |
| Corpus assembled (13 CVs + 6 failure fixtures) | DONE |
| Local-parser baselines (legacy + docling) | DONE |
| **Live Affinda calls** | **PENDING — `AFFINDA_API_KEY`/`AFFINDA_WORKSPACE_ID`/`AFFINDA_DOCUMENT_TYPE_ID` not yet provisioned** |

To run the live half:

```bash
cd deploy/server-12b
AFFINDA_API_KEY=aff_... AFFINDA_WORKSPACE_ID=... AFFINDA_DOCUMENT_TYPE_ID=... \
  npx tsx scripts/affinda-benchmark/run-benchmark.ts
```

Get credentials: `app.affinda.com` → Settings → API Keys; Workspace → Workflow → Integrations (workspace id); Document Types → Resume Parser → Settings (document type id). `AFFINDA_DELETE_AFTER_PARSE=1` is the default in the client — the document is deleted on Affinda's side immediately after parsing.

---

## 1. CORPUS

| FILE | FORMAT | KIND | EXPECTED / NOTES |
|---|---|---|---|
| KHUSHI .CV.docx | table-based DOCX | real | 5 exp/internship/clerkship groups; Pharm D; 12th/10th; `JULY/2022` dates; research/publications; Eng/Gujarati/Hindi |
| Shivang_Singh_Gangwar_Resume.docx | normal DOCX | real | edu 2, exp 2, projects 2, cert 1, ~20 skills |
| Shivang_Singh_Gangwar_Resume.pdf | single-column PDF | real | same content as DOCX |
| shivang-singh.pdf | PDF, letter-spaced headings | prior test fixture | "Test Candidate" resume |
| kunj modh (1) (1).docx | **image-only DOCX** | real | no text layer — OCR test |
| kunj modh (1) (1).pdf | PDF | real | Kunj resume, photo layout |
| Kunj_Manojkumar_Modh_Resume.pdf | PDF | real | edu 1, exp 3, projects 4, certs 7 |
| synth-table.docx | table-based DOCX | synthetic | 2 exp, 1 edu, publications, languages |
| synth-twocol.pdf | two-column PDF (sidebar) | synthetic | 2 exp, 1 edu, 2 certs, 3 languages |
| synth-singlecol.pdf | single-column PDF | synthetic | 2 exp, 2 edu, certs |
| synth-healthcare.pdf | healthcare PDF | synthetic | PharmD, clerkship + pharmacist, licenses, publication |
| synth-academic.docx | academic DOCX | synthetic | PhD, appointments, research, 2 publications, teaching, volunteer |
| synth-fresher.docx | fresher DOCX | synthetic | 3 edu (incl. 12th/10th), 2 projects, 0 work exp |
| corrupt.docx | corrupt | failure | PARSER_REJECTED / EMPTY_STRUCTURED_RESULT |
| blank.docx / blank.pdf | blank | failure | EMPTY_STRUCTURED_RESULT |
| sparse.docx | name+email only | failure | LOW quality / partial |
| Sample 1.pdf (Bachelor's SOP) | real non-resume essay | failure | NOT_A_RESUME |
| Shivang Singh Gangwar.pdf | real non-resume (AltUni certificate) | failure | NOT_A_RESUME — certificate, not a CV |

---

## 2. CURRENT-PARSER BASELINE (this run, no Affinda yet)

| FILE | LEGACY | DOCLING+MAPPER (current engine) |
|---|---|---|
| KHUSHI .CV.docx | PARTIAL — name+email; edu=5 mis-bucketed, exp=0, proj=15 (false) | **FAIL/EMPTY** — all 13,433 chars extracted but 0 structured records (known table-heading bug) |
| SHIVANG-DOCX | PARTIAL — name/email; edu=3 exp=2 (edu over-counted) | **EMPTY** — DOCX emits no section headers → mapper drops all |
| SHIVANG-PDF | PARTIAL — edu=21 noise | **GOOD** — edu 2, exp 2, proj 2, skills 20, cert 1 |
| TESTCAND-PDF | PARTIAL | PARTIAL — name+email, sections not segmented (letter-spaced headings) |
| KUNJ-DOCX-IMG | FAIL — INSUFFICIENT_TEXT (image-only) | FAIL — DOCLING_UNREADABLE (no text layer) |
| KUNJ-PDF | PARTIAL — exp=0 | PARTIAL — edu 1, exp 1, proj 2, cert 12, ach 8; name garbled ("Data Science Internpetpooja") |
| KUNJ-PDF-ALT | PARTIAL — exp=0, edu noise | **GOOD** — edu 1, exp 3, proj 4, cert 7, ach 4, skills 31 |
| SYNTH-TABLE | PARTIAL | EMPTY (same table-heading bug as Khushi) |
| SYNTH-2COL | PARTIAL — exp 2 | PARTIAL — exp 1 (sidebar merge), cert 1/2 |
| SYNTH-SINGLECOL | PARTIAL — exp=0 | PARTIAL — exp 2, edu 0 |
| SYNTH-HEALTH | PARTIAL | PARTIAL — exp 1, cert 3, edu 0, name missed |
| SYNTH-ACADEMIC | PARTIAL — edu=9 noise | EMPTY |
| SYNTH-FRESHER | PARTIAL — edu 3, proj 2 | EMPTY |
| CORRUPT-DOCX | FAIL (PARSE_FAILED) | FAIL (ConversionError) |
| BLANK-DOCX / BLANK-PDF | FAIL (INSUFFICIENT_TEXT / IMAGE_ONLY_PDF) | FAIL (DOCLING_UNREADABLE) |
| SPARSE | FAIL (INSUFFICIENT_TEXT) | 200 — email only, no records |
| NONRESUME-SOP | noise (edu=41 garbage) | 200 — empty |

**Baseline read:** the current docling+mapper path is correct only on heading-styled
single-column files (SHIVANG-PDF, KUNJ-PDF-ALT). Any DOCX without Word heading
styles — Khushi, Shivang-DOCX, both synthetic DOCX — returns **empty**, which is
worse than the legacy parser's noisy partial output. No language/publication
slots exist at all.

---

## 3. AFFINDA RESULTS

**PENDING CREDENTIALS.** The harness prints per-file:
`http status · duration · isResumeProbability · extractionQuality · counts per section · grounding stats · unmapped vendor fields` and stores raw JSON under `test-output/affinda/raw/<LABEL>.affinda.json`.

Khushi-specific checkpoints to verify on the live run:

- [ ] 5 experience/internship/clerkship groups separated
- [ ] Pharm D recognized as degree
- [ ] 12th/10th records preserved
- [ ] `JULY/2022` dates normalized
- [ ] research/publications captured (`publications[]` or `sections[]`)
- [ ] English/Gujarati/Hindi in `languages[]`
- [ ] achievements not merged into other sections
- [ ] table layout causes no loss

Regression checkpoints:

- [ ] SHIVANG: edu 2 / exp 2 / proj 2 / cert 1 — no degradation vs docling success case
- [ ] KUNJ (KUNJ-PDF-ALT): edu 1 / exp 3 / proj 4 / cert 7 — no degradation

---

## 4. INVENTED-DATA (GROUNDING) CHECK

Automated check implemented in `run-benchmark.ts`: every string field Affinda
returns (name, emails, phones, websites, org names, degrees, skills,
certifications, publications, languages, locations) is verified against the
extracted source text (normalized substring / ≥60% token overlap). Phones are
compared digit-only. Per-file counts land in `results.json` →
`affinda.grounding.{checked,unsupported,unsupportedValues[]}`.

**Results: PENDING live run.** UNSUPPORTED / INVENTED VALUES: `pending`

## 5. CANONICAL MAPPING — Affinda → ResumeCandidate

`affinda-adapter.ts` implements the benchmark adapter. Static audit:

| AFFINDA FIELD | D-VIVID SLOT | STATUS |
|---|---|---|
| name.raw/first/last | personalData.fullName/firstName/lastName | MAP DIRECTLY |
| emails[0] | personalData.email | MAP DIRECTLY |
| phoneNumberDetails[0].formattedNumber | personalData.phone | MAP DIRECTLY |
| location.city/country | personalData.currentCity/currentCountry | MAP DIRECTLY |
| linkedin / websites[] | personalData.linkedin/github | NEED TRANSFORMATION (filter by domain) |
| education[].organization | education[].institution | MAP DIRECTLY |
| education[].accreditation.education | education[].degree | MAP DIRECTLY |
| education[].accreditation.fieldsOfStudy | education[].fieldOfStudy | NEED TRANSFORMATION |
| education[].dates (ISO dates + rawText) | education[].startYear/endYear | NEED TRANSFORMATION |
| education[].grade.value/metric | education[].gpa/maxGpa | NEED TRANSFORMATION |
| workExperience[].organization/jobTitle | experience[].organization/role | MAP DIRECTLY |
| workExperience[].dates + isCurrent | experience[].startDate/endDate | NEED TRANSFORMATION |
| workExperience[].jobDescription | experience[].bullets | NEED TRANSFORMATION (split lines) |
| skills[].name (+type taxonomy) | skills.{technical,programming,tools,software,domain,soft} | NEED TRANSFORMATION (bucketing) |
| languages[] / languageCodes[] | skills.languages | NEED TRANSFORMATION (candidate-only slot) |
| certifications[] | certifications | MAP DIRECTLY |
| projects[] / PROJECTS section | projects[] | NEED TRANSFORMATION |
| achievements / ACHIEVEMENTS section | achievements | NEED TRANSFORMATION |
| **publications[]** | — | **NO CURRENT D-VIVID SLOT** |
| **sections[] (volunteer/research/other)** | — | **NO CURRENT D-VIVID SLOT** |
| objective / summary | — | NO CURRENT D-VIVID SLOT |
| totalYearsExperience | — | NO CURRENT D-VIVID SLOT |
| referees[] | — | NO CURRENT D-VIVID SLOT |
| dateOfBirth / headShot / profession | — | NO CURRENT D-VIVID SLOT |
| isResumeProbability | validation signal, not a field | NO CURRENT D-VIVID SLOT |

Adapter Zod-validates against `ResumeCandidateSchema` per file (`zodOk`,
`zodErrors` in results). **MAPPER COMPLEXITY: LOW–MEDIUM** — ~350 lines covering
all mapped fields; the heavy lifting is skills bucketing and date
normalization, both already proven patterns in `cv-mapper-docling.ts`.

## 6. SCHEMA GAP AUDIT

**SCHEMA EXTENSION NEEDED: YES.** Vendor fields that D-Vivid currently has no
canonical slot for (observed in schema, counts confirmed per-file at run time):

- `publications` — present in Affinda schema; **no ParsedCV/ResumeCandidate slot**
- `research` / `volunteerWork` / other typed `sections[]` — no slot
- `languages` — `ResumeCandidate.skills.languages` exists; **`ParsedCV` has no slot** (canonical profile drops languages today)
- `summary`/`objective`, `totalYearsExperience`, `referees` — no slot (arguably fine to ignore for profile prefill, but record decision)
- recommended: `additionalSections: string[]` catch-all on ParsedCV so vendor
  fields are never silently discarded

## 7. QUALITY / FAILURE BEHAVIOR

Client-side mapping (`affinda-client.ts`) — to be verified live:

| CONDITION | EXPECTED CODE | TRIGGER |
|---|---|---|
| vendor 400/422 (unparseable/rejected) | PARSER_REJECTED | corrupt.docx |
| 200 with `isResumeProbability < 0.3` | NOT_A_RESUME | SOP essay, certificate PDF |
| `meta.extractionQuality` low | LOW_EXTRACTION_QUALITY | sparse.docx |
| 200 but zero structured fields | EMPTY_STRUCTURED_RESULT | blank.docx/pdf |
| fetch timeout | VENDOR_TIMEOUT | — |
| network error / 5xx | VENDOR_UNAVAILABLE | — |
| 401/403 | VENDOR_UNAUTHENTICATED | bad key |

`isResumeProbability` is a dedicated vendor signal for NOT_A_RESUME — a cleaner
gate than anything in the current pipeline.

## 8. PRIVACY CHECK (verified 2026-09-30, sources below)

**What is sent:** the full CV file bytes via `POST {base}/v3/documents`
multipart — i.e., complete PII (name, contact, full history) leaves our infra to
Affinda cloud.

- **Retention:** documents are **retained indefinitely by default** — the earlier
  audit's "stateless/no retention" assumption is **incorrect**. Mitigations in
  the benchmark client: `deleteAfterParse=true` (default) deletes the document
  immediately after parsing; `expiryTime` schedules deletion; `DELETE
  /v3/documents/{id}` removes on demand. Vendor notes file-content is removed;
  metadata (e.g. filename) may persist in DB/backups.
  Source: https://docs.affinda.com/data-retention.md
- **Compliance:** ISO/IEC 27001:2022, SOC 2 Type 1 + Type 2, GDPR, HIPAA badges;
  subprocessors AWS, Azure, GCP, Elastic Cloud, Zendesk.
  Source: https://docs.affinda.com/trust.md
- **Data residency:** three instances — `api.affinda.com` (AUS/Global),
  `api.us1.affinda.com` (US), `api.eu1.affinda.com` (EU); account region selects
  where data is processed.
  Source: https://docs.affinda.com/resumes/integration
- **Training/use policy:** not explicitly stated in fetched docs; governed by
  their DPA/security docs (gated behind the trust center). **Action before any
  production use: obtain DPA / confirm no-training-on-customer-data clause.**

**PRIVACY ACCEPTABLE FOR TESTING: YES, with `deleteAfterParse=1`** — document is
deleted vendor-side immediately after parse; for extra safety the synthetic
corpus carries no real PII at all. Production use should re-confirm residency +
DPA, or revisit the self-hosted parser.

## 9. COST CHECK (verified 2026-09-30)

- Self-serve hosted resume parser: **US$0.10/document**; trial = 14 days
  including 1,000 free documents.
  Source: https://www.affinda.com/resume-parser/pricing/
- Self-serve credit top-ups bill at US$0.20/credit.
  Source: https://docs.affinda.com/resumes/credits.md
- Self-hosted licence from US$12,000/yr (500k docs) — out of scope for testing.

| VOLUME | @ $0.10/doc | @ $0.20/credit (conservative) |
|---|---|---|
| 100 CV/yr | $10 | $20 |
| 500 CV/yr | $50 | $100 |
| 1,000 CV/yr | $100 | $200 |
| 5,000 CV/yr | $500 | $1,000 |

**COST ACCEPTABLE FOR TESTING: YES** — the whole benchmark likely fits inside
the free trial.

## 10. GO / NO-GO CRITERIA

| # | Criterion | Result |
|---|---|---|
| 1 | Khushi parses meaningfully | pending live run |
| 2 | Shivang remains meaningfully correct | pending live run |
| 3 | Kunj remains meaningfully correct | pending live run |
| 4 | Diverse corpus consistent | pending live run |
| 5 | No concerning invented information | pending (automated grounding check ready) |
| 6 | Canonical mapping small | YES — ~350-line adapter, fields audited §5 |
| 7 | API failure handling manageable | YES — deterministic codes §7 (live verification pending) |
| 8 | Privacy/cost acceptable for testing | YES — §8/§9 |

---

## FINAL REPORT

AFFINDA ACCESS: **PENDING CREDENTIALS** (self-serve trial signup required — no key exists in repo/env)

KHUSHI: pending · SHIVANG: pending · KUNJ: pending

TOTAL RESUMES TESTED: 0 live (13 corpus + 6 failure fixtures staged)

TABLE-DOCX: pending · TWO-COLUMN PDF: pending · ACADEMIC/HEALTHCARE CV: pending

INVENTED DATA OBSERVED: pending (automated grounding check implemented)

CANONICAL MAPPER COMPLEXITY: **LOW–MEDIUM** (~350-line benchmark adapter; all slots audited)

SCHEMA EXTENSION NEEDED: **YES — `publications`, `research`, `volunteerWork`, `languages` (ParsedCV slot), `additionalSections` catch-all**

PRIVACY ACCEPTABLE FOR TESTING: **YES** — with `deleteAfterParse=1` (default in client); note default vendor retention is *indefinite* without it

COST ACCEPTABLE FOR TESTING: **YES** — $0.10–0.20/doc, trial covers benchmark

RECOMMEND: **MORE TESTING** — harness ready; live Affinda run blocked only on API key + workspace + document-type identifiers

PRODUCTION PARSER CHANGED: **NO** (`CV_PARSER_ENGINE` untouched; no route/profile/DB changes)

PROFILE WRITES: **0**
