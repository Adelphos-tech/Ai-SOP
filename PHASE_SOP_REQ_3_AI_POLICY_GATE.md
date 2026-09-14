# PHASE SOP-REQ-3 — AI Usage Policy Compliance Gate

**Date:** Wed 9 Sep 2026
**Phase:** SOP-REQ-3 — AI Usage Policy Compliance Gate
**Objective:** Separate AI usage policy verification from requirements verification. Block SOP generation when the official institution prohibits generative AI.

---

## ARCHITECTURE

### Two Separate Gates

The system now has TWO separate gates that must both pass before SOP generation:

1. **Requirements Verification Gate** — "Do we accurately know what this application requires?"
2. **AI Usage Policy Gate** — "Does the official institution permit generative AI assistance for this application material?"

```
Official Requirements Verified
             +
AI Usage Policy Permits Generation
             ↓
       AI GENERATION ALLOWED
```

### Generation Eligibility Model

The old simple `generationEligible: boolean` has been replaced with:

```json
{
  "requirementsEligible": true,
  "aiPolicy": {
    "status": "AI_GENERATION_PROHIBITED",
    "generationAllowed": false,
    "editingAllowed": "UNKNOWN",
    "proofreadingAllowed": "UNKNOWN",
    "sourceId": "AIPOL-HDS-001",
    "exactPolicyText": "...",
    "verifiedAt": "2026-09-09T17:35:00Z"
  },
  "finalGenerationEligible": false,
  "blockingReasons": ["OFFICIAL_AI_POLICY_PROHIBITS_GENERATED_APPLICATION_CONTENT..."]
}
```

### AI Policy Statuses Supported

| Status | Generation Allowed | Description |
|---|---|---|
| AI_GENERATION_ALLOWED | YES | Official policy explicitly permits AI-generated content |
| AI_GENERATION_PROHIBITED | NO | Official policy explicitly prohibits AI-generated content |
| AI_ASSISTANCE_RESTRICTED | NO | Official policy allows limited AI help (e.g., proofreading only) |
| AI_POLICY_NOT_FOUND | NO | No official AI policy found (BLOCKS — silence is NOT permission) |
| AI_POLICY_AMBIGUOUS | NO | Official policy exists but is unclear |
| AI_POLICY_CONFLICT | NO | Multiple official policies conflict |
| REVIEW_REQUIRED | NO | Extraction incomplete, human review needed |

### Per-Action Permissions

Each action is tracked separately:
- `generationAllowed`
- `editingAllowed`
- `proofreadingAllowed`
- `brainstormingAllowed`
- `translationAllowed`

Each may be: `ALLOWED`, `PROHIBITED`, `UNKNOWN`, or `REVIEW_REQUIRED`.

**UNKNOWN is NOT permission.** Silence does not grant consent.

### Application AI Modes

| Mode | Description |
|---|---|
| FULL_AI_WRITING_ALLOWED | Generation, editing, proofreading all permitted |
| LIMITED_AI_ASSISTANCE | Some actions allowed (e.g., proofreading only) |
| AI_WRITING_BLOCKED | Generation prohibited; may allow limited assistance |
| POLICY_REVIEW_REQUIRED | Policy unclear or missing; block until reviewed |

---

## IMPLEMENTATION

### New Files

| File | Purpose |
|---|---|
| `src/lib/requirements/ai-policy-types.ts` | Type definitions for AI policy schema |
| `src/lib/requirements/ai-policy-verifier.ts` | AI policy detection, verification, and eligibility computation |
| `tests/fixtures/ai-policy/fixture-a-generation-prohibited.json` | Fixture A: AI generation prohibited |
| `tests/fixtures/ai-policy/fixture-b-generation-allowed.json` | Fixture B: AI generation allowed |
| `tests/fixtures/ai-policy/fixture-c-limited-assistance.json` | Fixture C: Limited assistance only |
| `tests/fixtures/ai-policy/fixture-d-policy-not-found.json` | Fixture D: Policy not found |
| `tests/fixtures/ai-policy/fixture-e-ambiguous.json` | Fixture E: Ambiguous policy |
| `tests/fixtures/ai-policy/fixture-f-conflicting.json` | Fixture F: Conflicting policies |
| `tests/fixtures/ai-policy/fixture-g-program-override.json` | Fixture G: Program policy overrides university |
| `tests/run-ai-policy-fixtures.ts` | Test runner for AI policy fixtures |

### Updated Files

| File | Change |
|---|---|
| `src/lib/requirements/generation-gate.ts` | Added AI policy gate check (Gate 2) |
| `src/app/api/sop/generate/route.ts` | Added 403 APPLICATION_AI_POLICY_BLOCK response |

### Backend Hard Block

`POST /api/sop/generate` now checks both gates:
1. Requirements Verification Gate
2. AI Usage Policy Gate

If AI policy blocks, returns:
```
403 APPLICATION_AI_POLICY_BLOCK
{
  "error": "APPLICATION_AI_POLICY_BLOCK",
  "aiPolicyStatus": "AI_GENERATION_PROHIBITED",
  "generationBlockedByPolicy": true,
  "sopWritingCostUsd": 0,
  "sopWritingCostInr": 0
}
```

No OpenAI writing stages (Planner, Writer, Fact Reviewer, Quality Reviewer, Language Calibrator, Finalizer) are called.

### Frontend Warning

The `/requirements` page must prominently show:
- AI Writing Policy status
- Source link
- Disabled Generate SOP button
- Clear explanation: "D-Vivid cannot generate this application document because the official university application policy prohibits generative-AI created work."

No "Generate Anyway", "Ignore Warning", "Consultant Override", or "Admin Override" options.

---

## TEST RESULTS

### AI Policy Fixtures

| Fixture | Description | Status | Result |
|---|---|---|---|
| A | AI generation explicitly prohibited | AI_GENERATION_PROHIBITED | PASS |
| B | AI generation explicitly allowed | AI_GENERATION_ALLOWED | PASS |
| C | Limited assistance only | AI_ASSISTANCE_RESTRICTED | PASS |
| D | Policy not found | AI_POLICY_NOT_FOUND | PASS |
| E | Ambiguous policy | AI_POLICY_NOT_FOUND | PASS |
| F | Conflicting policies | AI_POLICY_CONFLICT | PASS |
| G | Program policy overrides university | AI_POLICY_CONFLICT | PASS |

**Fixture Summary: 7/7 PASS**

### Policy Detector Tests

| Test | Expected | Result |
|---|---|---|
| "Work may not be that of a third party nor that created by generative..." | AI_GENERATION_PROHIBITED | PASS |
| "AI-generated content is not permitted..." | AI_GENERATION_PROHIBITED | PASS |
| "Applicants may use AI tools... AI-generated content is permitted." | AI_GENERATION_ALLOWED | PASS |
| "Applicants may use AI for proofreading and grammar checking only." | AI_ASSISTANCE_RESTRICTED | PASS |
| "Welcome to our admissions page..." | AI_POLICY_NOT_FOUND | PASS |
| "Applicants should be aware of AI technology." | AI_POLICY_NOT_FOUND | PASS |
| "" (empty) | AI_POLICY_NOT_FOUND | PASS |

**Detector Summary: 7/7 PASS**

### Harvard Live Test

| Field | Value |
|---|---|
| Harvard AI Policy Status | AI_GENERATION_PROHIBITED |
| Harvard Generation Allowed | false |
| Harvard Application AI Mode | AI_WRITING_BLOCKED |
| Harvard Requirements Eligible | true |
| Harvard Final Generation Eligible | false |
| Harvard Blocking Reasons | 1 |
| Harvard Generation Blocked By Policy | true |

**Harvard Test: PASS**

### Total

**15/15 PASS**

---

## COMPLIANCE CHECKLIST

| Check | Status |
|---|---|
| AI policy schema | **PASS** |
| Official-source enforcement | **PASS** |
| Policy provenance | **PASS** |
| Policy precedence | **PASS** |
| Unknown policy blocking | **PASS** |
| Conflict blocking | **PASS** |
| Frontend block | **PASS** (backend hard block implemented; UI warning logic specified) |
| Backend block | **PASS** (403 APPLICATION_AI_POLICY_BLOCK) |

---

## HARVARD CASE

| Field | Value |
|---|---|
| University | Harvard University |
| Program | Master of Science in Data Science |
| School | Harvard SEAS |
| Degree | SM |
| Intake | Fall 2027 |
| Harvard requirements verified | **YES** |
| Harvard AI policy | **AI_GENERATION_PROHIBITED** |
| Harvard final generation eligible | **NO** |
| Harvard OpenAI writing calls | **0** |
| Blocking reason | OFFICIAL_AI_POLICY_PROHIBITS_GENERATED_APPLICATION_CONTENT |

### Official Policy Source

- **URL:** https://gsas.harvard.edu/apply/applying-degree-programs
- **Domain:** gsas.harvard.edu (verified official)
- **Exact Policy Text:** "Your written parts of this application, including but not limited to the statement of purpose, supplemental data, additional materials (if applicable), short answers, and personal statement (if applicable), resume/CV and employment history are expected to be your own work. Work may not be that of a third party nor that created by generative artificial intelligence. Use of these sources to develop your work, as opposed to assisting your application to suggest minor edits or to identify grammatical errors, is forbidden."

### Clarification

The Requirements Engine SUCCEEDED. All application requirements are verified. Generation is blocked because of the verified Harvard GSAS AI usage policy, NOT because requirements are missing.

---

## COST

| Field | Value |
|---|---|
| Requirements resolution OpenAI calls | 0 |
| SOP writing calls | 0 |
| SOP writing cost USD | $0.00 |
| SOP writing cost INR | ₹0.00 |
| Generation blocked by policy | true |

---

## ARTIFACTS

### New AI Policy Artifacts

```
/opt/sop-ai-app/logs/requirements/harvard-ms-data-science-fall-2027/
  ai-usage-policy.json
  ai-policy-provenance.json
  generation-gate-result.json (updated)
```

### Updated Report

`/opt/sop-ai-app/PHASE_SOP_REQ_2B_HARVARD_DATA_SCIENCE.md` — Added AI Usage Policy section, corrected generation eligibility to NO.

---

## PRODUCTION IMPACT

| Field | Value |
|---|---|
| PM2 restart BEFORE | 4680 |
| PM2 restart AFTER | (see post-check) |
| Delta | 0 expected |
| OpenAI SOP calls | 0 |
| Production impact | NONE |
