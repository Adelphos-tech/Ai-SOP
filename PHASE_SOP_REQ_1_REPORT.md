# PHASE SOP-REQ-1 — Official Application Requirements Engine

**Date:** Wed 9 Sep 2026
**Phase:** SOP-REQ-1 — Official Application Requirements Engine
**Objective:** Build the official-source Application Requirements Engine that runs BEFORE SOP planning/writing.

---

## HARD PRODUCT RULE

NO GENERIC FALLBACK IS ALLOWED. Requirements may be derived ONLY from:
1. Official university/program webpages
2. Official university admissions/application PDFs or guides
3. Official country-level government/education/immigration sources

If required application information cannot be verified from an approved official source: BLOCK SOP GENERATION.

---

## Benchmark Terminology Correction

Updated benchmark reporting to distinguish strict vs tolerance word range compliance:

- **STRICT_WORD_RANGE_PASS:** 0/5 (all cases exceeded 900-1100 default range)
- **TOLERANCE_WORD_RANGE_PASS (10%):** 4/5 (R003 at 1248 words exceeds 1210 tolerance)

Historical generated outputs and quality scores were NOT altered.

---

## Architecture

```
src/lib/requirements/
  types.ts                 — All TypeScript type definitions (177 lines)
  domain-verification.ts   — Official domain verification + registry
  html-extractor.ts        — Server-side HTML fetching + deterministic parsing
  pdf-extractor.ts         — PDF extraction architecture (pluggable converter)
  conflict-detector.ts     — Conflict detection + precedence resolution
  freshness.ts             — Freshness/caching logic (7-day default TTL)
  requirements-db.ts       — File-based verified requirements database
  resolver.ts              — Main requirements resolver (cache-first)
  generation-gate.ts        — Server-side generation blocking gate

src/app/api/requirements/
  resolve/route.ts         — POST: resolve requirements for application identity
  verify/route.ts          — POST: check generation gate

src/app/api/sop/generate/route.ts — Updated with requirements gate check

src/app/requirements/page.tsx — Requirements UI page with confirmation

tests/
  run-requirements-fixtures.ts — Test fixture runner (21 tests)
  fixtures/
    fixture-a-verified-word-limit.json
    fixture-b-prompt-no-word-limit.json
    fixture-c-pdf-requirements.json
    fixture-d-conflicting-sources.json
    fixture-e-unverifiable.json
    fixture-f-multiple-essays.json
    fixture-g-country-override.json
```

---

## Component Status

| Component | Status |
|---|---|
| Requirements schema | PASS |
| Official source policy | PASS |
| Official domain verification | PASS |
| HTML extraction | PASS |
| PDF architecture | PASS |
| Field-level provenance | PASS |
| Conflict detection | PASS |
| Freshness/caching | PASS |
| Country guidance priority | PASS |
| No generic fallback | PASS |
| Generation block | PASS |
| Requirements confirmation UI | PASS |
| Source viewing | PASS |
| Test fixtures | 7/7 PASS |
| Deterministic parsers | 6/6 PASS |
| Domain verification tests | 5/5 PASS |
| Generation gate tests | 3/3 PASS |
| OpenAI SOP calls | 0 |

---

## Test Results: 21/21 PASS

### Fixture Tests (7/7)

| Fixture | Description | Result |
|---|---|---|
| A | Verified official webpage with clear word limit | PASS |
| B | Official page with explicit prompt but no word limit | PASS |
| C | Official PDF requirements | PASS |
| D | Conflicting official sources | PASS |
| E | Unknown/unverifiable requirement | PASS |
| F | Multiple essay questions | PASS |
| G | Country guidance + program-specific override | PASS |

### Deterministic Parser Tests (6/6)

| Input | Expected | Result |
|---|---|---|
| "Maximum 1000 words" | max=1000, VERIFIED | PASS |
| "500-750 words" | min=500, max=750, VERIFIED | PASS |
| "up to 500 words" | max=500, VERIFIED | PASS |
| "1000-word statement" | max=1000, VERIFIED | PASS |
| "at least 300 words" | min=300, VERIFIED | PASS |
| "no word limit mentioned" | UNKNOWN | PASS |

### Domain Verification Tests (5/5)

| URL | Expected | Result |
|---|---|---|
| asu.edu (subdomain) | verified=true | PASS |
| ox.ac.uk | verified=true | PASS |
| studyinaustralia.gov.au | verified=true | PASS |
| reddit.com | verified=false | PASS |
| random-blog.com | verified=false | PASS |

### Generation Gate Tests (3/3)

| Scenario | Expected | Result |
|---|---|---|
| No brief provided | BLOCKED | PASS |
| Unapproved fact sheet | BLOCKED | PASS |
| No bypass exists | No bypass | PASS |

---

## Key Design Decisions

1. **UNKNOWN vs NOT_SPECIFIED_BY_OFFICIAL_SOURCE**: The engine distinguishes between "we couldn't verify" (UNKNOWN → may BLOCK) and "we checked the official source and it explicitly has no word limit" (NOT_SPECIFIED_BY_OFFICIAL_SOURCE → does not BLOCK).

2. **Program-specific override**: Program-specific official instructions have priority over generic university-wide instructions. If precedence clearly resolves a conflict, it is not a CONFLICT.

3. **No generic fallback**: If a requirement cannot be verified, it is marked UNKNOWN. The generation gate blocks SOP generation when required fields are UNKNOWN. There is NO bypass button or path.

4. **Field-level provenance**: Every material requirement field has its own provenance record with source ID, exact quote, verification timestamp, program match, and intake match.

5. **Cache key**: Keyed by country + university + program + degreeLevel + intake + intakeYear. Never mixes programs (MS Data Science ≠ MS Computer Science even at same university).

6. **Freshness**: Default 7-day TTL, configurable via REQUIREMENTS_FRESHNESS_HOURS environment variable.

7. **Cost separation**: Requirements resolution cost is tracked separately from SOP writing cost (both are $0 in this phase since no AI/crawling was used).

8. **Server-side gate**: The generation gate is enforced server-side in /api/sop/generate. Frontend state is not trusted alone.

---

## Production Impact

- **Public frontend:** 200 (unchanged)
- **Local frontend:** 200 (unchanged)
- **Backend:** 200 (unchanged)
- **SOP app:** 200 on 127.0.0.1:5010
- **PM2 restart count BEFORE:** 4680
- **PM2 restart count AFTER:** 4680
- **Delta:** 0
- **nginx:** active (unchanged)
- **OpenAI SOP calls:** 0
- **Production impact:** NONE

---

## Next Steps (NOT executed in this phase)

- Live university research with official source discovery
- AI-assisted requirement extraction from official content
- Integration with existing Fact Sheet → SOP generation flow
- Cost optimization with Terra/Luna models
- Prompt caching activation
