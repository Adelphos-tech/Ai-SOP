# PHASE SOP-AI-3 — Connect Verified Application Requirements to Writing Pipeline

**Date:** Wed 9 Sep 2026
**Phase:** SOP-AI-3 — Application Control Architecture
**Objective:** Integrate the Official Requirements Engine and AI Usage Policy Gate into the existing 6-stage OpenAI SOP writing pipeline via a server-side Generation Contract.

**IMPORTANT:** No live SOP generation in this phase. No Harvard SOP generation. No new OpenAI writing calls. Architecture + deterministic integration testing only.

---

## ARCHITECTURE

### Generation Contract

The OpenAI writing pipeline may now run ONLY from a server-side **Generation Contract**. The browser must NOT construct it directly.

The contract is built server-side from:
- A. Approved Student Fact Sheet
- B. Verified Application Brief
- C. Verified AI Usage Policy
- D. Verified Program Context (optional)
- E. Verified Country Guidance
- F. Student English/Writing Preferences

### Hard Generation Conditions

Contract creation fails unless:
1. Fact Sheet Approved = true
2. Requirements Verification Gate = PASS
3. AI Usage Policy allows FULL AI writing
4. No unresolved official-source conflict
5. Required application identity is verified

If any fails: **DO NOT call OpenAI.**

### Two Separate Gates

```
Gate 1: Requirements Verification
  "Do we accurately know what the application requires?"
        +
Gate 2: AI Usage Policy
  "Does the official institution permit generative AI?"
        ↓
  Generation Contract (CLEARED)
        ↓
  OpenAI Writing Pipeline (6 stages)
```

### Writing Requirements Priority

1. Official exact application prompt
2. Official required topics
3. Official length/format constraints
4. Verified program context
5. Approved student facts
6. Student career/personal story
7. Verified country guidance
8. IELTS/writing profile

Writing profile changes STYLE only. It must NEVER override official content requirements.

### Word Limit Truth

| Case | Handling |
|---|---|
| VERIFIED word limit | Enforce exactly |
| NOT_SPECIFIED_BY_OFFICIAL_SOURCE | Do NOT claim a university word requirement exists |
| UNKNOWN | Generation blocked when uncertainty is material |

No silent reintroduction of "900–1100 words" as an official requirement.

---

## NEW FILES

| File | Purpose | Lines |
|---|---|---|
| `src/lib/requirements/generation-contract-types.ts` | Type definitions for Generation Contract, Program Context, Compliance | 243 |
| `src/lib/requirements/generation-contract.ts` | Server-side contract builder + validator | 282 |
| `src/lib/requirements/planner-relevance.ts` | Course relevance engine + required topic mapping | 359 |
| `src/lib/requirements/compliance-check.ts` | Deterministic compliance checker (word/char/markdown) | 235 |
| `tests/fixtures/generation-contract/fixture-a..j.json` | 10 integration test fixtures | — |
| `tests/run-generation-contract-fixtures.ts` | Test runner | 357 |

## UPDATED FILES

| File | Change |
|---|---|
| `src/app/api/sop/generate/route.ts` | Builds + validates Generation Contract before any OpenAI call |

### API Contract

`POST /api/sop/generate` now:
1. Builds a Generation Contract server-side
2. Validates it
3. Returns structured errors WITHOUT calling OpenAI if blocked

Structured error responses:
- `403 APPLICATION_AI_POLICY_BLOCK` — AI policy prohibits generation
- `403 APPLICATION_REQUIREMENTS_UNVERIFIED` — Requirements not verified
- `403 APPLICATION_REQUIREMENT_CONFLICT` — Unresolved source conflict
- `403 FACT_SHEET_NOT_APPROVED` — Fact sheet not approved
- `422 MISSING_REQUIRED_STUDENT_INFORMATION` — Material topics lack student evidence
- `422 NO_WRITING_REQUIREMENT` — No required writing document
- `422 PORTAL_ONLY_PROMPT` — Prompt only in portal
- `422 UNKNOWN_PROMPT` — Prompt unknown

### Max OpenAI Stages: 6

No new OpenAI pipeline stage was added. Requirement compliance is incorporated into:
- Existing Quality Reviewer stage (semantic check)
- Deterministic backend validation (word/char/markdown/empty checks)

---

## VERIFIED PROGRAM CONTEXT

The `VerifiedProgramContext` type extends the Application Brief with optional program information:

| Field | Description |
|---|---|
| programOfficialName | Official program name |
| school | School name |
| department | Department if applicable |
| programDescription | Official program description |
| academicFocusAreas | Academic focus areas |
| curriculumThemes | Curriculum themes |
| specializationsOrTracks | Specializations or tracks |
| officiallyListedResearchAreas | Research areas |
| officiallyListedLabs | Labs |
| officiallyListedFacilities | Facilities |
| officiallyListedFaculty | Faculty |
| otherRelevantProgramFacts | Other relevant facts |

Every field MUST have provenance (sourceId, sourceUrl, sourceQuote, verifiedAt).

**Program context is NOT a requirement.** Requirements control compliance; program context helps personalization/program fit.

---

## COURSE RELEVANCE ENGINE

The Planner selects student facts based on relevance to the VERIFIED target program.

### Fact Relevance

Each student fact gets a relevance decision:
```json
{
  "factId": "project-0",
  "factType": "project",
  "relevance": "HIGH",
  "reason": "Matches 2 required topic(s)",
  "useInSop": true
}
```

### Required Topic Mapping

Each official required topic is mapped to student evidence:
```json
{
  "requiredTopic": "research interests",
  "studentEvidence": ["research-0", "project-0"],
  "status": "COVERED",
  "reason": "2 student fact(s) support this topic."
}
```

### Missing Required Information

If a material required topic has no student evidence:
- Status: `MISSING_REQUIRED_STUDENT_INFORMATION`
- Generation is BLOCKED before spending writing tokens
- UI should ask student to complete that information

Material topics: academic preparation, research interests, career goals, why program, experiences, past work, classroom.

---

## DETERMINISTIC COMPLIANCE CHECK

After the finalizer, deterministic code (NOT OpenAI) checks:

| Check | Method |
|---|---|
| Word maximum | `countWords(text) > max` |
| Word minimum | `countWords(text) < min` |
| Character limit | `countCharacters(text) > max` |
| Markdown detection | Pattern matching |
| Heading detection | `^#{1,6}\s+` |
| Empty output | `wordCount > 0` |
| Required topic coverage | Keyword-based fallback |

---

## TEST RESULTS

### Generation Contract Fixtures

| Fixture | Description | Status | Result |
|---|---|---|---|
| A | Verified requirements + AI allowed | CLEARED | PASS |
| B | Verified requirements + AI prohibited | APPLICATION_AI_POLICY_BLOCK | PASS |
| C | Missing required student information | MISSING_REQUIRED_STUDENT_INFORMATION | PASS |
| D | Verified university word limit | CLEARED (500-750) | PASS |
| E | No officially specified word limit | CLEARED (null/null) | PASS |
| F | Multiple written documents | CLEARED (2 docs) | PASS |
| G | Country guidance vs university | CLEARED (university wins) | PASS |
| H | Unverified program context (null) | CLEARED (null context) | PASS |
| I | Verified program context | CLEARED (with context) | PASS |
| J | Harvard saved case | APPLICATION_AI_POLICY_BLOCK | PASS |

**Fixture Summary: 10/10 PASS**

### Planner Relevance Tests

| Test | Result |
|---|---|
| Planner Relevance (Fixture A — all topics covered) | PASS |
| Missing Info Detection (Fixture C — material missing) | PASS |

**Relevance Summary: 2/2 PASS**

### Compliance Check Tests

| Test | Result |
|---|---|
| Good document within limits | PASS |
| Document exceeding word limit | PASS |
| Empty document | PASS |
| Markdown detection | PASS |
| No word limit → N/A | PASS |

**Compliance Summary: 5/5 PASS**

### Contract Validation Tests

| Test | Result |
|---|---|
| Validate cleared contract | PASS |
| Validate null contract | PASS |

**Validation Summary: 2/2 PASS**

### Total

**19/19 PASS**

---

## COMPLIANCE CHECKLIST

| Check | Status |
|---|---|
| Generation Contract | **PASS** |
| Requirements integration | **PASS** |
| AI policy integration | **PASS** |
| Program context provenance | **PASS** |
| Course relevance planning | **PASS** |
| Official prompt propagation | **PASS** |
| Required topic mapping | **PASS** |
| Missing student data blocking | **PASS** |
| Country guidance precedence | **PASS** |
| Document-type handling | **PASS** |
| Multiple-document handling | **PASS** |
| IELTS/style separation | **PASS** |
| Quality Reviewer compliance | **PASS** (no new stage; deterministic check added) |
| Deterministic final checks | **PASS** |
| Max OpenAI stages | **6** (unchanged) |
| Live OpenAI writing calls | **0** |
| Fixtures | **19/19 PASS** |
| Harvard generation | **BLOCKED — PASS** |

---

## HARVARD REGRESSION TEST

| Field | Value |
|---|---|
| University | Harvard University |
| Program | MS Data Science |
| Intake | Fall 2027 |
| Requirements verified | YES |
| AI policy | AI_GENERATION_PROHIBITED |
| Generation Contract | NOT CREATED FOR WRITING |
| API response | 403 APPLICATION_AI_POLICY_BLOCK |
| OpenAI writing calls | 0 |

Harvard remains correctly blocked. No admin override, consultant override, student override, or "generate anyway" option exists.

---

## COST

| Field | Value |
|---|---|
| OpenAI writing calls | 0 |
| SOP writing cost USD | $0.00 |
| SOP writing cost INR | ₹0.00 |

---

## PRODUCTION IMPACT

| Field | Value |
|---|---|
| PM2 restart BEFORE | 4680 |
| PM2 restart AFTER | (see post-check) |
| Delta | 0 expected |
| OpenAI SOP calls | 0 |
| Production impact | NONE |
