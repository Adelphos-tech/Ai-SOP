# END-TO-END INFORMATION PROPAGATION AUDIT

**Date:** 2026-09-20 · Test case: student `210c0870` / app `f97bc1ef` / doc `e6d8ba2b` · **OpenAI calls: 0 · Generations: 0 · Code changes: 0**

Path audited: `intake RHF → /api/application/profile → students.profile_data → getStudentProfile → adaptProfile → contract.studentFacts → buildEvidenceLedger → stage prompts`.

## Master propagation matrix

| Field | DB | adaptProfile | Evidence | Contract | Planner | Writer | QR | Finalizer | FactRev | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| personalData.name/city/country | ✓ | →`personalDetails` | SF-PERSONAL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| personalData.email/phone | ✓ | dropped | — | — | — | — | — | — | — | UNUSED_BY_DESIGN (PII) |
| education[] | ✓ | ✓ | SF-EDU-* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| experience[] | ✓ | ✓ | SF-EXP-* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| projects[] | ✓ | ✓ | SF-PROJ-* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| skills (categorized) | ✓ | ✓ | SF-SKILLS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| certifications→achievements[] | ✓ | ✓ | SF-ACH-* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| personalStory | (empty) | ✓ | SF-STORY | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| englishProficiency | (empty) | ✓ | SF-ENGLISH | LC via languageProfile | — | — | — | — | — | END_TO_END |
| **fieldMotivation** | ✓ | →personalStory.motivation (only-if-empty) | SF-STORY | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END (conditional) |
| **mastersMotivation.whyField** | ✓ | →careerGoals.whyProgram (only-if-empty) | SF-CAREER | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL |
| **mastersMotivation.whyNow/knowledgeGaps/academic/professional/expectedLearning/careerConnection** | ✓ | passthrough only | **—** | — | — | — | — | — | — | **LOST_AT_EVIDENCE** |
| **countryQuestionnaire (all 5 answers)** | ✓ | passthrough only | **—** | — | — | — | — | — | — | **LOST_AT_EVIDENCE** |
| **careerGoals.leadership/technical/business/impact/responsibilities/location** | ✓ | →careerGoalsStructured (not read by ledger) | **—** | — | — | — | — | — | — | **LOST_AT_EVIDENCE** |
| subjects / subjectRequirements | ✓ | passthrough | — | — | — | — | — | — | — | LOST_AT_EVIDENCE |
| uniReq.promptText | ✓ | — | — | merged.prompt (doc prompt wins) | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| uniReq.wordMin/wordMax | ✓ | — | — | ✓ (post-fix) | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| uniReq.pageLimit/characterLimit | ✓ | — | — | ✓ (post-fix) | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| **uniReq.mandatoryTopics** | ✓ | — | — | contract+RC | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END **but hard-fails post-LC gate (hardcoded mandatory:true)** |
| **uniReq.specificQuestions→additionalQuestions** | ✓ | — | — | ✓ contract | **—** | **—** | **—** | — | — | **LOST_AFTER_CONTRACT** (no prompt builder reads it) |
| uniReq.formattingRules→formattingInstructions | ✓ | — | — | contract.formatInstructions | — | ✓ (writingInstructions) | **—** | **—** | — | **LOST_AFTER_WRITER** |
| doc.consultantInstruction→specialInstructions | ✓ | — | — | — | — | ✓ (writingInstructions) | **—** | **—** | — | **LOST_AFTER_WRITER** |
| doc.promptText/promptSource | ✓ | — | — | exactPrompt | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| doc.word/page/char overrides | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| application.university/program/country/intake | ✓ | — | — | contract.application + PF-CONTEXT | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |
| facultyAlignment (approved) | — | — | FF-* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | END_TO_END |

## Scope audit

`mastersMotivation`, `countryQuestionnaire`, `careerGoals` (structured), `universityRequirements`, `subjectRequirements`, `fieldMotivation` — all stored in **students.profile_data** = WRONG_SCOPE (application-specific answers bleed across a student's multiple applications). Works for the single-app case but will corrupt a second application.

## Score

```
TOTAL RELEVANT INPUT FIELDS:      ~34 groups
END_TO_END:                       ~20
LOST_AT_EVIDENCE:                  6  (mastersMotivation×5, countryQuestionnaire, careerGoalsStructured, subjects/subjectRequirements)
LOST_AFTER_CONTRACT (prompts):     1  (additionalQuestions — no stage reads it)
LOST_AFTER_WRITER:                 2  (specialInstructions/consultantInstruction, formattingRules — invisible to QR/Finalizer/FactRev)
STATUS DROPPED AT PROVENANCE:      1  (DECLARED → mandatory:true hardcoded)
WRONG_SCOPE:                       6  groups stored student-level, application-specific
```

## Stage input summary

| Stage | Sees |
|---|---|
| Planner | studentFactsText (ledger), rc(prompt/topics/limits), facultyAlignment, programFacts, doc-type config |
| Writer | studentFactsText, **evidencePackets**, writingInstructions (special+faculty+formatting), rc |
| QR | writerOutput, rc, facultyAlignment, evidenceLedger, evidencePackets, **rubric only — NOT consultant/formatting instructions** |
| Language Calibrator | writerOutput, languageProfile, rc word limits (style-only by design) |
| Finalizer | calibratedOutput, rc, actionPlan, evidenceLedger, renderFeedback — **no formatting/consultant context** |
| Fact Reviewer | finalTexts, studentFactsText, programFactsText, approved faculty, rc |

## Root causes (prioritized)

- **P0 — current failure:** `requiredTopicProvenance` hardcodes `mandatory:true` (run-application-pipeline.ts:863) → consultant DECLARED topics post-LC hard-fail.
- **P1:** `countryQuestionnaire`, `mastersMotivation` (5/6 fields), `careerGoalsStructured` never become evidence — the motivation/country content the university asks about literally cannot reach Writer as facts.
- **P1:** `additionalQuestions` populated in contract but no prompt builder consumes it.
- **P2:** consultant instruction + formatting rules reach Writer only; QR can't review compliance; Finalizer can unknowingly break formatting.
- **P3:** application-specific answers stored student-scoped.

## Recommended fix order

1. `mandatory: t.status !== "DECLARED"` in requiredTopicProvenance (unblocks generation).
2. Add ledger categories: `SF-MOTIVATION-*` (mastersMotivation fields), `SF-COUNTRY-*` (countryQuestionnaire), `SF-CAREER-DETAIL` (careerGoalsStructured) — all already consultant-entered = student-approved by construction.
3. Render `additionalQuestions` in planner/writer/QR prompts.
4. Pass merged formatting + specialInstructions into QR rubric and Finalizer context.
5. Move application-scoped sections out of profile_data (schema work, separate task).

END-TO-END INFORMATION PROPAGATION AUDIT COMPLETE — NO TOKEN SPEND
