# Word-Limit Contract Fix

Date: 2026-09-19 · Trigger: generation `0a6f78fd` produced ~613 words against a resolved 800–1000 requirement.

## Root cause

`wordLimit.min` was present in the Generation Contract (`generation-contract.ts:105`) but **dropped before every AI stage** — writer/QR emitted only `.max`, planner/finalizer/LC received nothing, and post-final checks counted words without comparing them.

## What changed

| Area | File | Change |
|---|---|---|
| Canonical length context | `src/lib/ai/length-context.ts` (new) | `resolveLengthContext` (min/max/target = min + round(range×0.4) → 880 for 800–1000), `lengthStatusFor`, `describeLengthContext`, `wordsOf` (delegates to `countWordsForText` — one counting rule) |
| Planner prompt | `prompts/generic/planner.ts` | min/max/target now in rcDesc + "plan enough substance for the target, don't pad, don't invent" |
| Writer prompt | `prompts/generic/writer.ts` | max-only → strict `WORD COUNT REQUIREMENT` block (min/max/target, never fabricate for length) |
| QR prompt | `prompts/generic/quality-reviewer.ts` | deterministic `currentWords` + `Length status` per component; model reports from the given status, not its own count |
| LC prompt | `prompts/generic/language-calibrator.ts` | optional `responseComponents` param → length constraints + "do not compress a draft at/below minimum" |
| Action planner | `component-action-planner.ts` | per-component `lengthStatus`/`currentWords`/`targetWords` in plan; factual-cleanup COMPRESS on a BELOW_MIN component gets an explicit no-shrink + expand-toward-target directive; real page overflow still wins |
| Finalizer (bounded) | `bounded-finalizer.ts` | instruction now carries `wordLimit {min,max,target}` + `currentWords` + `lengthStatus`; system gains LENGTH FLOOR rules (BELOW_MIN → compression forbidden) |
| Legacy finalizer prompt | `prompts/legacy/finalizer-generic.ts` | same length context block (kept consistent for any remaining consumers) |
| Post-final checks | `output/post-final-checks.ts` | `lengthCompliance` per component: BELOW_MIN/WITHIN_RANGE/ABOVE_MAX/NO_LIMIT — **advisory, never fatal** |
| Pipeline | `run-application-pipeline.ts` | server-overrides `wordCompliance`/`requirementCompliance.wordLimit` from deterministic status (model can't contradict arithmetic); LC gets responseComponents; post-final checks get limits |

## Deviation note (§7)

Spec asked for `TARGETED_COMPLIANCE_REPAIR` when factual cleanup + below-min. That action is bound to mandatory-topic provenance — every `repairClaim.topicId` must be a real contract `missingTopic` with a per-topic evidence allowlist (`claim-provenance.ts:344-380`), and non-contract topics fail `validateFinalizerActionPlan` ("exact required contract topic"). Routing length repair through it would weaken topic-evidence safety. Achieved equivalent outcome instead: COMPRESS-as-bounded-edit with a hard length floor + expand-toward-target directive (rephrasing retained claims is permitted). Safety validators untouched.

## Static verification (min=800, max=1000, writer=719)

- targetWords: **880** · Planner sees min: **YES** · Writer sees min/max/target: **YES**
- QR receives currentWords=719 + status BELOW_MIN: **YES** (+ server-side override if it disagrees)
- LC knows draft is below min: **YES**
- Action planner shrink-directive below min: **forbidden** (real page overflow still allowed)
- Finalizer receives min/max/target/status: **YES**
- Post-final compares count vs range: **YES** — advisory only, never fatal

**AI stages: 6 unchanged · New AI calls: 0 · Prompts/models/ceilings/transport: unchanged (instructions added, no behavior removal) · Zod work: untouched**

## Result

OPENAI CALLS: 0 · GENERATIONS: 0 · `tsc --noEmit`: clean
