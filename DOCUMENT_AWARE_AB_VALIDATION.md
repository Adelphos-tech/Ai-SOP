# Document-Aware A+B Validation — 3-Run Report

Date: 2026-09-18
Config: `EXPERIMENT_COMPACT_REVIEWS=1` + `EXPERIMENT_NARRATIVE_PROFILES=1`
Models: all six stages `gpt-5.6-sol` (no Terra)
Caps used: MAX_EXPERIMENT_GENERATIONS=3, MAX_EXPERIMENT_COST_INR=150
Test DB: sop_ai_app_test (prod profiles cloned, zero prod mutation)

## Results

| | Bench-SOP-sparse | Moksh-VISA | Kunj-PS |
|--|------------------|------------|---------|
| Document type | STATEMENT_OF_PURPOSE | VISA_SOP | PERSONAL_STATEMENT |
| Generation ID | d61f42d6-409e-47a1-b87d | 1f1d2ffd-cee5-4a33-ba34 | a6d095f0-f2ac-4f0f-89e2 |
| **Cost INR** | **₹40.16** | **₹51.50** | **₹38.13** |
| Cost USD | $0.4185 | $0.5367 | $0.3973 |
| Latency | 255s | 249s | 180s |
| Word count | 489 | 723 | 491 |
| Invented facts | **0** | **0** | **0** |
| Altered facts | **0** | **0** | **0** |
| Interpretive | 9 | 0 | 8 |
| Ambiguous | 0 | 0 | 0 |
| Requirement compliance | all PASS | all PASS | all PASS |
| Word/char/page | N/A (none configured) | N/A | N/A |

Total spend: $1.3525 / ₹129.78 — within the ₹150 cap. 3/3 generations, 18 paid calls.

## Bench-SOP-sparse assessment

- **Hallucination under sparse evidence: NONE.** Every claim traces to the thin 3.7KB profile — parents as educators, BIT + CGPA 8.7, Smart Campus Nav (React/Mapbox/Node/Mongo, 500 students), TechSolutions internship (30% API improvement). Closed-world held.
- **Generic filler: LOW.** Appropriately short at 489w — the writer did not pad to a target. Mild filler ("analytical and collaborative approach") but no invented substance.
- **Narrative coherence: GOOD.** Clean arc — origin → project → internship → synthesis → program → goals, 2 anchors per the SOP profile.

Verdict: **PASS** — sparse profiles produce honest, coherent, correctly-short output.

## Moksh-VISA assessment

- **Evidence/chronological clarity: STRONG.** Internships ordered with exact dates (Jan–Mar 2024 → Feb–Aug 2026), each with concrete scope.
- **Study rationale: present** — deeper theoretical grounding in DS+AI+Cloud stated.
- **Country/program rationale: partial** — US + Corpus University MS CS named; country-level "why US" reasoning is thin but evidence-bound.
- **Career logic: present; RETURN-HOME: correctly omitted (CORRECTION).** Post-hoc verification: `homeCountryPlans` is literally `"nothing"` and `shortTerm.location` is "United States" — **no supported return-home evidence exists**, so omission was correct evidence discipline, not a gap. The planner's "return plan tied to India" note was model interpretation, not evidence. The conditional-requirement mechanism added in the A+B production fix now handles both cases deterministically.
- **SOP-style storytelling: controlled.** Structured and evidence-led, though ¶6–8 lean essay-like; acceptable for the format.

Verdict: **PASS** — return-home omission was correct (no supported evidence). Conditional requirement mechanism now added for the evidence-present case.

## Kunj-PS assessment

- **Personal voice: MODERATE.** Frames growth ("shifted my focus from building functional applications to understanding...") — more personal than the SOP baseline but still formal.
- **Reflection: present per anchor** — each experience states what it taught and how it redirected him.
- **Anchor selection: correct** — 2 anchors (Prodigy web dev, Petpooja data science) per the PS profile.
- **CV-to-prose: residual.** ¶2–3 enumerate internship tasks (portfolio, weather app, stopwatch, calculator; FaceNet pipeline, pincode scraper) — integrated with reflection but still list-adjacent. The PS profile's tech limit (1/para) reduced but didn't eliminate enumeration.
- **No invented motivation:** 0 invented facts; motivations are evidence-tied ("strengthened my interest").

Verdict: **PASS** — meaningfully better than CV-in-prose; enumeration reduced not eliminated.

## Summary

| Check | Result |
|-------|--------|
| Fact safety (invented/altered) | **0 / 0 across all 3 — PASS** |
| Requirement compliance | PASS ×3 |
| SOP-like narrative improvement | PASS (Bench clean, PS improved) |
| Cross-type damage | None observed |
| Known gap | None — VISA omission was correct (see correction) |
| Avg cost | ₹43.26 vs Moksh all-sol baseline ₹59.97 (**−27.9%**) |

A+B adopted as production default (see `narrative-profile.ts` + DISABLE_* rollback flags). A+B+D was not run per instruction.

DOCUMENT-AWARE A+B VALIDATION COMPLETE
