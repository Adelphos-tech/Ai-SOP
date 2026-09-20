# SHIVANG CV — SEMANTIC MAPPER FIX

**Date:** 2026-09-20 · CV: `Shivang_Singh_Gangwar_Resume(1).pdf` (hash 2d047d07) · **Profile writes:** 0 · **OpenAI:** 0 · **Generations:** 0

## Raw block audit (see `SHIVANG_DOCLING_BLOCK_TRACE.md`)

**DOCLING RAW BLOCKS CORRECT: YES** — 27 blocks, correct reading order, correct section headers, all content present. Zero extraction changes made; this was purely a mapper-structure mismatch.

### Why the mapper lost structure (three layout differences vs the earlier CV)

1. **Experience entries = 3 consecutive headers per job** — `role + date` header ("Business Analyst Sep 2023 - Aug 2024"), then company header ("Ciright Inc"), then location-only header ("|  Philadelphia, PA (Remote)"). The old per-header→record logic produced 5 fake records.
2. **Education + skills sections arrive as ONE merged text block each** — multiple `Degree | Institution, City dates` records inside a single block; skill groups `Label: items` appear inline mid-line separated by `·`.
3. **Combined heading `EDUCATION & CERTIFICATIONS`** contains both degree records AND a certification record — no separate CERTIFICATIONS heading.

## Fixes (mapper only — `cv-mapper-docling.ts`)

- **Experience state machine:** header with date-range → open `role+date` entry; subsequent non-date headers attach as org/location (`|`-prefixed → location); a non-date header only opens a new entry when the previous one is complete (org + bullets). Org-first layouts (Kunj CV) unchanged.
- **Education merged-block segmentation:** blocks containing degree words + `|` + date-ranges are split at date-range boundaries; trailing undated tail → certification if it matches cert patterns (`Product Management Certification - AltUni by Inside IIM`).
- **Combined section:** `EDUCATION & CERTIFICATIONS` → EDUCATION segment; per-record classification routes certs to `certifications`.
- **Skills multi-group:** labels located at `:` boundaries anchored to `·`/`•`/`|` or block start; strict label validation (spaced `/` allowed, intra-word `/` like `STT/TTS` rejected → word-drop recovery keeps items like `Deepgram STT/TTS` in the previous group).
- **Projects:** strip ` GitHub ↗` decorations; `Name - Tech Stack` split → name + technologies.
- **Summary contamination:** education records only ever form inside EDUCATION segments — "MBA in Information Technology (Dec 2025)" in SUMMARY cannot create a record (unchanged, verified).

## Results

```
COMBINED EDUCATION/CERTIFICATION HEADING FIX: YES
EXPERIENCE ASSEMBLY FIX:                      YES
PROJECT SEGMENTATION FIX:                     YES
SKILLS GROUP FIX:                             YES

                    EXPECTED   ACTUAL
Education              2         2   (MBA IT @ Intl Univ of Applied Sciences, Berlin 2024–2025;
                                     BCA @ Indus University, Ahmedabad 2016–2020 — no GPA invented)
Experience             2         2   (Business Analyst @ Ciright Inc, Philadelphia PA Remote,
                                     Sep 2023–Aug 2024, 4 bullets; BA→PM @ Ambimat Electronics,
                                     Ahmedabad, Apr 2021–Aug 2023, 4 bullets)
Projects               2         2   (AI Real Estate Voice Agent — Llama 3 + Qdrant + Deepgram;
                                     AI Tutoring Platform — Adaptive Voice Learning)
Certifications         1         1   (Product Management Certification — AltUni by Inside IIM)
Skills                 multi     20  (14 technical incl. Deepgram STT/TTS, 6 domain)
Personal                        ✓   Shivang Singh Gangwar · shivangsingh191@gmail.com
                                    +91 79905 81321 · Ahmedabad

Regression (Kunj CV): education 1, experience 3, projects 4, certs 7 — UNCHANGED
INVENTED VALUES: 0 (no GPA/dates/maxGpa fabricated — absent fields stay empty)
SUMMARY-DERIVED DUPLICATE MBA: NO
PROFILE WRITES: 0
OPENAI CALLS: 0
DOCUMENT GENERATIONS: 0
```

SHIVANG CV SEMANTIC MAPPER FIXED — READY FOR MANUAL REVIEW
