# MISSING_REQUIRED_STUDENT_INFORMATION — SECOND ROOT-CAUSE AUDIT

**Date:** 2026-09-20 · **OpenAI calls made by this audit:** 0 · **Generations:** 0

## Exact failed attempt

```
studentId:     210c0870-29d2-4660-becf-f4235a474748
applicationId: f97bc1ef-a880-47af-a085-f334eb29cb6d
documentId:    e6d8ba2b-66a3-41d9-b60f-904ed7badcc4
latest failed run: 1f8dec80 (12:56–12:59 CEST)
failure: MISSING_REQUIRED_STUDENT_INFORMATION at 12:59:41
```

## Two different gates, two different runs — the second run is NOT the pre-gate

| run | stages | provider calls | failed at | gate |
|---|---|---|---|---|
| c13d308e (12:41) | 0/6 | 0 | pre-Stage-1 | `checkMandatoryTopicEvidence` — topics were REQUIRED (pre-DECLARED deploy) |
| **1f8dec80 (12:56)** | **4/6** (LC done) | **yes** | post-Stage-4 | **`checkMissingMandatoryTopics` (run-application-pipeline.ts:992)** |

## Exact throw site — proven statically

`run-application-pipeline.ts:857-868`:

```ts
topics: rc.requiredTopics.map((t: any) => ({
  topicId: t.topic,
  text: t.topic,
  requirementType: "MANDATORY_REQUIRED_TOPIC" as const,  // HARDCODED
  mandatory: true,                                       // HARDCODED — DECLARED dropped
})),
```

Every `requiredTopic` — including consultant-entered `DECLARED` ones — is projected to `mandatory: true`. Then `checkMissingMandatoryTopics` (claim-provenance.ts:433): any `topic.mandatory` present in `actionPlan.missingTopics` with no `allowedEvidenceIds` → `MISSING_REQUIRED_STUDENT_INFORMATION`.

Chain: consultant topic reaches prompts → QR marks `covered: false` → actionPlan.missingTopics → hard-fail. Same code also reachable via `actionPlan.blocked` at component-action-planner.ts:241/254.

## Status at each step

```
resolver:      DECLARED  (a968ad8 deployed)
contract:      DECLARED  (rc.requiredTopics[].status preserved)
provenance:    mandatory: true  ← DECLARED LOST HERE (hardcoded)
gate:          treated as MANDATORY → block
```

- DECLARED fix present in running prod: **YES**
- Old contract snapshot involved: **NO** (contract rebuilt fresh each run)
- Stale retry/checkpoint: **NO**
- Genuine profile data missing: **NO** (personalData/education/experience/projects all persisted)
- Official verified blocker: **NO** (prompt_source=CONSULTANT_PROVIDED, no writing_requirement_id)
- UI "Ready to generate" vs gate: UI checks presence-of-data only; gate checks per-topic evidence coverage — **mismatch by design gap**.

## Root cause classification: **B** (status normalized to REQUIRED-equivalent) — `mandatory: true` hardcoded in the provenance projection.

## Minimal fix

`run-application-pipeline.ts:863`: propagate status —
```ts
mandatory: t.status !== "DECLARED",
requirementType: t.status === "DECLARED" ? "OPTIONAL_QUALITY_SUGGESTION" as const : "MANDATORY_REQUIRED_TOPIC" as const,
```
That single change exempts consultant topics from both post-LC checks while keeping them in prompts. (Not applied yet per "audit first" instruction.)

SECOND MISSING-INFO ROOT CAUSE AUDIT COMPLETE — NO TOKEN SPEND
