# DOCLING CV PARSER MIGRATION — PHASE 1

**Date:** 2026-09-20 · **Docling:** 2.129.0 · **OPENAI calls:** 0 · **Generations:** 0

## Architecture

```
CV file → POST /api/application/cv-upload (auth, rate-limit, magic-bytes,
              10MB, dedup — UNCHANGED)
        → CV_PARSER_ENGINE=legacy (default) → existing cv-parser.ts
                         =docling           → internal HTTP POST
                                             services/cv-parser (FastAPI, 127.0.0.1:8099)
                                             → ParsedDocument {blocks[type,text,page,order,bbox]}
                                             → cv-mapper-docling.ts (section-aware mapper)
                                             → sanitizeCandidate() (deterministic sanity)
                                             → ResumeCandidateSchema (Zod)
                                             → ParsedCV + confidence/provenance/parserMeta
                                             → existing Review UI → identity guard → Apply/Replace
```

Docling never touches the canonical profile. `cv-parser.ts` retained — flag default `legacy`.

## Validated on the exact failing CV (`Kunj_Manojkumar_Modh_Resume.pdf`, 2 pages, two-column)

| | LEGACY | DOCLING |
|---|---|---|
| Education rows | **21 bogus** ("India", "me", "nit", sentence fragments, skill labels) | **1 correct** — Indus University / B.Tech CSE / CGPA 8.47/10 / 2022–2026 |
| Experience | 0 (lost entirely) | 3 — Sustainalyze (Research), Petpooja, Prodigy Infotech |
| Projects | 15 (skill lines as projects) | 4 — correct names |
| Certifications | 4 | 7 |
| Bogus "India" institution | YES (legacy) | NO |
| Fake defaults (8.5/2020/2024/IIT Bombay) | none seen | none — no invented values |
| Parse time | <1s | ~48s cold (first model load), **~3s warm** |

Mapper details: section-keyword segmentation (entry titles inside sections can't become section boundaries), ≥2-signal minimum for education records, name = ALL-CAPS page-1 header (company headers can't win), name-header inside a section closes the open entry (prevents sidebar-date misassociation), orphan date blocks attach only to date-less education entries (MEDIUM confidence), `cv-docling-*` provenance ids.

## Production deployment — BLOCKED, report only

```
Prod host: 15GB RAM (11 free), 6 cores — but disk 100% FULL (391M of 96G)
Docling footprint: ~3–5GB (docling + torch + layout models)
→ CANNOT deploy service to prod until disk cleanup.
Options: (a) free disk, run as systemd unit on 127.0.0.1:8099
         (b) separate parser container/host via Dockerfile provided
Code deploy is SAFE: flag defaults to legacy; docling path unused.
```

## Security preserved
10MB cap, extension+magic-byte+DOCX-ZIP validation, rate limit, auth, private storage, hash dedupe — all in cv-upload, all unchanged. Service binds 127.0.0.1 only.

## Report

```
DOCLING VERSION: 2.129.0
DEPLOYMENT MODEL: internal FastAPI sidecar (127.0.0.1:8099), Dockerfile provided;
                  prod blocked on disk space — flagged, not deployed
PARSER SERVICE: UP (local dev) / NOT DEPLOYED (prod)
PDF: DOCLING behind flag | DOCX: DOCLING (default Word pipeline) — Mammoth retained via legacy
OCR: off for text-native PDFs; auto-retry with OCR only when text layer ~empty

LEGACY PARSER RETAINED: YES (CV_PARSER_ENGINE=legacy default; CV_PARSER_FALLBACK=legacy optional)
RESUME CANDIDATE ZOD: YES (resume-candidate.schema.ts)
FIELD PROVENANCE: YES (source text + page + confidence per record; never persisted)
CONFIDENCE: YES (HIGH/MEDIUM/LOW deterministic)

NO INVENTED DEFAULTS: YES — all fields absent unless in source text

CURRENT BAD-CV RESULT:
  REAL EDUCATION COUNT: 1
  DOCLING EDUCATION COUNT: 1 ✓
  BOGUS "India" RECORD: NO
  BOGUS SENTENCE INSTITUTION: NO
  REPEATED FAKE DEFAULTS: NO

IDENTITY GUARD RETAINED: YES (unchanged — fires before merge)
CV MERGE/REPLACE RETAINED: YES
REVISION GUARD RETAINED: YES

OPENAI CALLS: 0
DOCUMENT GENERATIONS: 0
PRODUCTION PROFILE WRITES: 0

STATUS: READY FOR USER MANUAL CV TEST
  Local: cd services/cv-parser && .venv/bin/uvicorn app:app --port 8099
         CV_PARSER_ENGINE=docling npm run dev
```

DOCLING CV PARSER IMPLEMENTED — MANUAL VALIDATION REQUIRED
