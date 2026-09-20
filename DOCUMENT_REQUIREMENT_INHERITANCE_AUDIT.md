# DOCUMENT CREATION — REQUIREMENT INHERITANCE AUDIT

**Date:** 2026-09-20 · **OpenAI calls:** 0 · **Generations:** 0

## Identified scope

- **studentId:** `210c0870-29d2-4660-becf-f4235a474748` (Shivang Singh Gangwar)
- **applicationId:** `f97bc1ef…` (latest, created 2026-09-20)

## 1. Persisted University Requirements (`students.profile_data.universityRequirements`)

| field | persisted value |
|---|---|
| promptText | "Explain your academic and professional development…" (saved, present) |
| wordMin | **850** ✓ |
| wordMax | **1000** ✓ |
| characterLimit | "" (empty) |
| pageLimit | "" (empty in DB — the "2" seen earlier was in a different app's intake) |
| mandatoryTopics | 4 lines — academic prep, professional experience, project learning, motivation… |
| specificQuestions | 3 lines — why this university/program, curriculum fit, PM gap |
| formattingRules | "continuous professional SOP, no bullet points, no section headings…" |

## 2. Root cause — requirements were LOST (option B)

`resolveAndMergePrompt()` in `generation-context.ts`, Case 3 (`CONSULTANT_PROVIDED`/`USER_PROVIDED_PORTAL_PROMPT`/`CUSTOM`) resolved **only `document.*` fields**. `profile.universityRequirements` was loaded by the context loader but **never passed into the resolver**. Blank advanced fields → `undefined` → `wordLimit.min/max: null` in the generation contract → **850/1000/2 would never reach Planner/Writer/QR**.

Worse: `requiredTopics` and `additionalQuestions` were hardcoded `[]` in `generation-service.ts` — mandatoryTopics/specificQuestions were dropped for **every** prompt source, not just consultant-provided.

## 3. Fix — field-level inheritance (`generation-context.ts`, `generation-service.ts`)

Resolver signature: `resolveAndMergePrompt(document, writingRequirement, universityRequirements)`.

Precedence now (field-by-field, all prompt-source paths):

```
explicit document override → saved University Requirements → default template
```

- `CONSULTANT_PROVIDED`: `doc.X || uniReq.X` for wordMin/wordMax/characterLimit/pageLimit/formatting; `requiredTopics`/`additionalQuestions` populated from `mandatoryTopics`/`specificQuestions` (newline-split).
- `DVIVID_DEFAULT_TEMPLATE`: same inheritance before template fallback.
- `OFFICIAL_VERIFIED`: official values win; uniReq fills only absent fields.
- `generation-service`: `requiredTopics` → `ResponseComponentTopic[]` (`sourceId: university_requirements`), contract `requiredTopics`/`additionalQuestions` wired (previously hardcoded `[]`).

A consultant-provided **prompt** now overrides only `promptText` — it no longer discards limits/topics/formatting.

## 4. UI — inherited values now visible

Add Document → Advanced options: each blank field shows placeholder = inherited value and a hint **"Inherited from University Requirements: 850"**. Typing a number creates an explicit override — no retyping required.

## Report

```
APPLICATION REQUIREMENTS:  min=850, max=1000, page="" (empty), topics=4, questions=3, formatting=present
ADD DOCUMENT UI SHOWED:    min=blank, max=blank, page=blank (no hint)
BLANK MEANT (BEFORE):      effectively NONE — document nulls reached the contract unchanged
BLANK MEANS (NOW):         INHERIT from University Requirements
GENERATION WOULD RESOLVE (after fix):
  prompt source:           CONSULTANT_PROVIDED (custom prompt wins)
  min: 850 · max: 1000 · page: (inherited if set)
  mandatory topics:        4 → contract.requiredTopics + RC.requiredTopics
  university questions:    3 → contract.additionalQuestions
  formatting:              formattingRules → formatInstructions
CONSULTANT PROMPT DISCARDS EXISTING LIMITS: NO (fixed)
CODE FIX: resolver field-level inheritance + contract wiring
UI SHOWS INHERITED REQUIREMENTS: YES
OPENAI CALLS: 0
GENERATIONS: 0
```

DOCUMENT REQUIREMENT INHERITANCE AUDITED — READY FOR MANUAL DOCUMENT CREATION
