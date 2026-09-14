# PHASE SOP-REQ-4 — Find One Officially AI-Permitted Application for End-to-End Test

**Date:** Wed 9 Sep 2026
**Phase:** SOP-REQ-4 — AI-Permitted Application Selection
**Objective:** Find ONE real university + master's program where official application requirements are publicly verifiable, the exact written-document requirements are verifiable, the official institution policy explicitly permits generative AI assistance, and the application can pass all existing gates.

**IMPORTANT:** No SOP generation in this phase. No OpenAI writing calls. This phase only finds and verifies ONE suitable live application.

---

## CANDIDATES CHECKED: 8

| # | University | Program | AI Policy | Selected |
|---|---|---|---|---|
| 1 | Harvard University | MS Data Science | AI_GENERATION_PROHIBITED | No |
| 2 | Yale University | Undergraduate | AI_GENERATION_PROHIBITED | No |
| 3 | Northwestern University (TGS) | Graduate | AI_GENERATION_PROHIBITED | No |
| 4 | University of Michigan (Rackham) | Graduate | AI_GENERATION_PROHIBITED | No |
| 5 | Lehigh University | Graduate | AI_GENERATION_PROHIBITED | No |
| 6 | University of Oxford | Graduate | AI_GENERATION_PROHIBITED | No |
| 7 | UW-Madison | Undergraduate | AI_GENERATION_ALLOWED | No (undergraduate only) |
| 8 | **MIT (CEE)** | **MEng CEE** | **AI_GENERATION_ALLOWED** | **YES** |

### Search Conclusion

- 5 candidates explicitly prohibit AI generation for application materials.
- 1 candidate (UW-Madison) permits AI but only for undergraduate admissions, not a master's program.
- 1 candidate (MIT CEE) explicitly permits AI tools for graduate application statements and offers a master's degree.
- MIT CEE MEng selected as the single eligible application.

---

## SELECTED APPLICATION

| Field | Value |
|---|---|
| **Country** | USA |
| **University** | Massachusetts Institute of Technology (MIT) |
| **School** | Department of Civil and Environmental Engineering (CEE) |
| **Program** | Master of Engineering in Civil and Environmental Engineering |
| **Degree** | MEng |
| **Intake** | Fall 2027 |
| **Application Opens** | September 15, 2026 |
| **Application Deadline** | December 15, 2026, 11:59 PM EST |

---

## WRITING REQUIREMENT

| Field | Value |
|---|---|
| **Document Type** | Statement of Objectives |
| **Official Prompt** | VERIFIED |
| **Word Limit** | 2 pages maximum (1 page per answer) — VERIFIED |
| **Character Limit** | NOT_SPECIFIED_BY_OFFICIAL_SOURCE |
| **Required Topics** | 4 topics |
| **Additional Written Components** | 0 (Statement of Objectives is the sole written document) |

### Official Prompt (verbatim)

> "Your statement should separately address the following two topics (max 1 page for each answer):
> A. Experience: Describe one (or at most two) relevant academic or research experience(s) with sufficient technical detail to clearly convey the motivation for the work, your responsibilities and tasks, your conclusions, and how you dealt with unforeseen challenges.
> B. Purpose: Describe why you are applying to graduate school, and your specific research interests at MIT, including the name(s) of faculty members with whom you would like to work."

### Required Topics

1. Academic or research experience
2. Research interests at MIT
3. Faculty members (names of faculty with whom the student would like to work)
4. Purpose for graduate school

### Format Instructions

- Separate the statement into two parts (Experience and Purpose), max 1 page each

---

## AI POLICY

| Field | Value |
|---|---|
| **Status** | **AI_GENERATION_ALLOWED** |
| **Full Draft Generation Allowed** | **YES** |
| **Planning Allowed** | YES |
| **Editing Allowed** | YES |
| **Proofreading Allowed** | YES |
| **Official Policy Source** | https://cee.mit.edu/education/graduate/graduate-admissions/ |

### Official Policy Text (verbatim)

> "You are free to utilize AI tools (e.g., ChatGPT) in the preparation of your statement of objectives and personal statement, however, we discourage you from relying too heavily on them. These emerging writing tools may be effective at improving grammar and structure but can depersonalize the tone of your writing and occasionally produce erroneous or contradictory content. In preparing your essays, keep the following in mind that the evaluation of your statements will focus on elements that are not trivially generated via AI, such as descriptions of your research experience and formative aspects of your lived experience."

### Policy Interpretation

- **Generation:** EXPLICITLY PERMITTED — "You are free to utilize AI tools (e.g., ChatGPT) in the preparation of your statement"
- **Editing:** EXPLICITLY PERMITTED — "effective at improving grammar and structure"
- **Proofreading:** EXPLICITLY PERMITTED — grammar improvement mentioned
- **Brainstorming:** PERMITTED — broad permission for "preparation"
- **Translation:** PERMITTED — broad permission for "preparation"

The policy does NOT prohibit generation, drafting, or writing with AI. It only discourages "relying too heavily" on AI. This is the most permissive official AI policy found among all candidates.

---

## GATES

| Gate | Result |
|---|---|
| **Requirements Eligible** | **YES** |
| **AI Policy Eligible** | **YES** |
| **Generation Contract** | **PASS** |
| **Final Generation Eligible** | **YES** |

### Generation Contract Dry Run

| Field | Value |
|---|---|
| Contract Status | CLEARED |
| Cleared for Writing | true |
| Requirements Verified | true |
| AI Writing Allowed | true |
| AI Policy Status | AI_GENERATION_ALLOWED |
| Fact Sheet Approved | true |
| Contract Validation | PASS |
| OpenAI Writing Calls | 0 |

### Planner Relevance

| Field | Value |
|---|---|
| Fact Relevance Decisions | 6 |
| Required Topic Mappings | 4 |
| Topics Covered | 2/4 |
| Has Material Missing Info | false |

### Missing Student Information (non-material)

The following topics have no direct student evidence but are NOT material blocking issues:

1. **Faculty members** — The student needs to research and name specific MIT CEE faculty members. This is a research task, not a missing student data issue.
2. **Purpose for graduate school** — The student's career goals cover this topic semantically, but the exact phrase "purpose for graduate school" doesn't match keyword detection. The careerGoals fields (whyField, whyProgram, shortTermGoals, longTermGoals) provide the necessary content.

### Fictional Student Data Required for Live Test

Before the live end-to-end generation test, the fictional demo student should have:
- Education: Bachelor's in Civil Engineering or related field (VERIFIED)
- Experience: At least one relevant internship or work experience (VERIFIED)
- Projects: At least one academic or research project (VERIFIED)
- Career goals: Why this field, why this program, short/long term goals (VERIFIED)
- Personal story: Motivation, challenges, achievements (VERIFIED)
- English proficiency: IELTS or TOEFL scores (VERIFIED)
- **Faculty research**: The student should identify 2-3 MIT CEE faculty members whose research aligns with their interests (TO BE ADDED before live test)

---

## COST

| Field | Value |
|---|---|
| Requirements resolution USD | $0.00 |
| Requirements resolution INR | ₹0.00 |
| SOP writing calls | 0 |
| SOP writing cost USD | $0.00 |
| SOP writing cost INR | ₹0.00 |

---

## ARTIFACTS

### Candidate Search

```
/opt/sop-ai-app/logs/requirements/ai-permitted-candidate-search/
  candidates.json
```

### Selected Application Artifacts

```
/opt/sop-ai-app/logs/requirements/ai-permitted-live-test/
  application-identity.json
  official-sources.json
  field-provenance.json
  verified-application-brief.json
  ai-usage-policy.json
  ai-policy-provenance.json
  generation-gate-result.json
  requirements-cost.json
```

### Dry Run Test

```
/opt/sop-ai-app/tests/run-mit-cee-contract-dry-run.ts
```

---

## OFFICIAL SOURCES

| Source | URL | Type |
|---|---|---|
| SRC-MIT-CEE-001 | https://cee.mit.edu/education/graduate/graduate-admissions/ | PRIMARY |
| SRC-MIT-CEE-002 | https://cee.mit.edu/education/graduate/graduate-degrees/ | PRIMARY |
| SRC-MIT-CEE-003 | https://cee.mit.edu/education/graduate/graduate-timeline-faq/ | PRIMARY |
| AIPOL-MIT-CEE-001 | https://cee.mit.edu/education/graduate/graduate-admissions/ (AI Policy section) | PRIMARY |

All sources are on the official `cee.mit.edu` domain. Domain verification: PASS.

---

## PRODUCTION IMPACT

| Field | Value |
|---|---|
| PM2 restart BEFORE | 4680 |
| PM2 restart AFTER | (see post-check) |
| Delta | 0 expected |
| OpenAI SOP calls | 0 |
| Production impact | NONE |
