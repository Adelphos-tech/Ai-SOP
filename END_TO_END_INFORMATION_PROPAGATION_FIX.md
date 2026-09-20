# END-TO-END INFORMATION PROPAGATION — ROOT FIX

**Date:** 2026-09-20 · **OpenAI calls:** 0 · **Generations:** 0 · **AI stages:** 6 unchanged

## Changes

### P0 — DECLARED status preserved end-to-end

- `generation-gate.ts`: new `isHardMandatoryTopicStatus()` — single definition (VERIFIED/REQUIRED/MANDATORY_REQUIRED_TOPIC → hard; everything else → not). Pre-gate + action planner + provenance all use it.
- `run-application-pipeline.ts`: `requiredTopicProvenance` no longer hardcodes `mandatory:true` — derives from contract status; DECLARED → `OPTIONAL_QUALITY_SUGGESTION`, `mandatory:false`.
- `component-action-planner.ts`: uncovered topics split into hard (`missingTopics`, can block) vs soft/DECLARED (`softMissingTopics`, repair-eligible when evidence exists, never block). FREEZE reason no longer claims MISSING_INFO when only soft topics are uncovered.

**Verified statically with real Shivang profile data:** DECLARED uncovered → `blocked:false`; REQUIRED uncovered → `blocked:true` (safety preserved).

### P1 — intake sections become evidence (`evidence-ledger.ts`)

New per-field student entries (all approved applicant statements):

```
SF-MOTIVATION-{FIELD}      mastersMotivation.whyField/whyNow/skillGaps/academicMotivation/professionalMotivation/expectedLearning/careerSupport
SF-COUNTRY-{KEY}           countryQuestionnaire.answers.* (whyCountry, whyNotHomeCountry, careerSupport, postStudyIntentions, educationSystemAttraction)
SF-CAREER-{SCOPE}-{FIELD}  careerGoalsStructured.shortTerm.{role,industry,responsibilities,location} + longTerm.{vision,goals,impact,homeCountryPlans}
```

Real-data trace (student 210c0870): evidence entries **35 total** — motivation (7), country answers (5), career detail (7) all present → visible to Planner/Writer/QR/Finalizer/Fact Reviewer via `studentFactsText` + evidence packets.

### P1 — additionalQuestions reach stages

`ResponseComponent.additionalQuestions?: string[]` → populated from contract → rendered in Planner/Writer/QR via new shared `formatComponentRequirements()` (`prompts/generic/component-requirements.ts`), which also splits Required vs Requested topics so stages know the distinction.

### P2 — consultant instruction + formatting beyond Writer

- **QR**: new `complianceInstructions` param — receives `pipelineWritingInstructions` (specialInstructions + formatting + faculty instructions) so it can evaluate compliance.
- **Finalizer**: new `complianceConstraints` arg — contract constraints appended to system prompt ("do not reintroduce prohibited formatting / drop required topics / violate limits").

## Static trace results (current test case)

```
DECLARED topics:   preserved YES · hard-block NO · Planner/Writer/QR visible YES
mastersMotivation: 7 fields saved → 7 evidence entries → Writer YES
countryQuestionnaire: 5 answers saved → 5 evidence entries → Writer YES
careerGoals:       structured fields saved → 7 evidence entries → Writer YES
additionalQuestions: Planner YES · Writer YES · QR YES
consultantInstruction: Writer YES · QR YES
formattingRules:   Writer YES · QR YES · Finalizer YES
fact review:       motivation/country/career evidence now canonical — valid applicant statements won't be flagged unsupported
previous failed run re-evaluated: DECLARED uncovered → NO hard block
```

END-TO-END INFORMATION PROPAGATION FIX DEPLOYED — READY FOR ONE MANUAL GENERATION
