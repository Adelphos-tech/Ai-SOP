# Document-Specific Evidence Selection

## Summary

Implemented ONE central document-specific evidence policy layer that derives a
document-specific evidence packet from the canonical evidence ledger, without
duplicating canonical facts or adding an AI stage.

```
Full Canonical Evidence Ledger (unchanged, canonical)
        ↓
DocumentEvidencePolicy(documentType)
        ↓
DocumentEvidencePacket  →  Planner / Writer / Quality Reviewer

Final Fact Reviewer  →  FULL canonical evidence ledger (unchanged)
```

## Architecture

### Full canonical ledger preserved

- `buildEvidenceLedger()` / `buildApplicationEvidenceBundle()` are unchanged.
- The canonical ledger remains the ONE server-side factual world.
- No facts are duplicated. No new ledger is created.
- The full ledger is retained on every `DocumentEvidencePacket.fullLedger`
  reference and remains in pipeline results/checkpoints.

### Central policy registry

`DOCUMENT_EVIDENCE_POLICIES` in
`src/lib/ai/document-evidence-policy.ts` — keyed by every canonical
`DocumentType`.

Each policy supports per-category priority:
- `HIGH` — prefer / include when available
- `MEDIUM` — include with lower emphasis
- `LOW` — include only as supporting detail, subject to `maxItems`
- `EXCLUDE` — do not include by default

Optional per-category `maxItems` caps the number of entries after priority
selection. `requiredForQuality` is **advisory metadata only** — it is NOT a
generation gate.

### Semantic categories (derived, not duplicated)

`classifyEvidenceEntry()` deterministically maps existing canonical ledger
entry IDs / source strings to semantic categories. No new facts, no schema
change to `EvidenceEntry`. Categories covered:

`personalData`, `education`, `experience`, `projects`, `research`,
`publications`, `skills`, `achievements`, `certifications`,
`fieldMotivation`, `mastersMotivation`, `countryQuestionnaire`, `careerGoals`,
`personalStory`, `recommenderContext`, `visaEvidence`, `applicationData`,
`programEvidence`, `facultyEvidence`, `officialRequirements`, `documentPrompt`,
`consultantInstruction`, `englishProficiency`, `writingPreferences`, `other`.

Requirement categories (`programEvidence`, `facultyEvidence`,
`applicationData`, `officialRequirements`, `documentPrompt`,
`consultantInstruction`) ALWAYS pass through — they are document/program
requirements, not applicant evidence, and must not be filtered by
student-fact priority.

### Document types covered

All 11 canonical `DocumentType` values:

- `STATEMENT_OF_PURPOSE`
- `ESSAY`
- `SUPPLEMENTAL_QUESTION`
- `MOA` (Memorandum of Agreement — per existing product meaning)
- `PERSONAL_STATEMENT`
- `STATEMENT_OF_ACADEMIC_PURPOSE`
- `LETTER_OF_MOTIVATION`
- `VISA_SOP`
- `COVER_LETTER`
- `LETTER_OF_RECOMMENDATION`
- `CUSTOM` (conservative broader packet; also the fallback for unknown types)

## Stage routing

### Planner uses filtered packet: YES

`run-application-pipeline.ts` — Planner now receives
`formatDocumentEvidencePacketText(documentEvidencePacket)` instead of the full
`studentFactsText`.

### Writer uses filtered packet: YES

Writer receives the filtered packet text + evidence packets built from
`buildFilteredLedgerView(documentEvidencePacket)` (a filtered projection of the
canonical ledger, preserving the original `ledgerHash`). Planner evidence
selection is now validated against the filtered ledger.

### Quality Reviewer uses filtered packet: YES

QR receives `buildFilteredLedgerView(documentEvidencePacket)` + the filtered
evidence packets — the same relevant scope as Writer, plus document
requirements. The full canonical ledger remains available in pipeline
results/checkpoints for audit.

### Finalizer uses filtered/repair-relevant evidence: YES

The Finalizer PROMPT receives `buildFinalizerLedgerView(documentEvidencePacket,
repairAuthorizedIds)` — the document-specific filtered packet PLUS any
repair-authorized evidence IDs from the action plan's `topicEvidence`. This
prevents the Finalizer from reintroducing details the Writer correctly omitted.

The full canonical ledger remains stored internally for audit/checkpoints/
provenance verification and pipeline results — but is NOT dumped into the
Finalizer prompt.

### Fact Reviewer uses full evidence: YES

The Final Fact Reviewer is **unchanged** — it continues to receive the full
canonical `studentFactsText` + `programFactsText`. Writer/Finalizer relevance
filtering does not weaken factual verification.

## Priority does NOT create hard blockers

`requiredForQuality` is advisory. Missing `HIGH`/`MEDIUM`/`LOW` evidence NEVER
fails generation. Only the existing legitimate minimum-data gates remain fatal
(e.g. no usable student information at all — handled by the pipeline, not
here). The document-evidence-policy layer never throws on missing evidence and
always produces a packet (possibly empty).

## Measured context reduction (Shivang-like fixture)

Fixture: 30 canonical ledger entries (education, 3 experiences, 2 projects,
skills, 2 achievements, certifications, research, publications, masters
motivation, country questionnaire, structured career goals, personal story,
english proficiency, writing preferences, application-specific recommender
context, program context, faculty alignment).

Measured with the same formatter (apples-to-apples character comparison):

| Document type | Selected entries | Excluded | Characters | % of full |
|---|---|---|---|---|
| Full ledger | 30 | 0 | 4114 | 100% |
| VISA_SOP | 22 | 8 | 3111 | 76% |
| STATEMENT_OF_PURPOSE | 29 | 1 | 4011 | 97% |
| LETTER_OF_RECOMMENDATION | 17 | 13 | 2458 | 60% |

No cost claims are made from these numbers — only measured character counts
using the existing safe text formatter.

## Shivang evidence counts

Two Shivang datasets are reported:

### Deterministic Shivang-like test fixture (used by tests #9–#10)

- Shivang full evidence: 30 entries
- Shivang VISA_SOP selected: 27 entries
- Shivang VISA_SOP selected: 22 entries
- Shivang SOP selected: 29 entries
- Shivang LOR selected: 17 entries

### Real Shivang DB record (zero-token preflight, no OpenAI)

Student `b2793710…`, application `9da2c0ca…`, document
`1edfaa8b…` (STATEMENT_OF_PURPOSE). This record has minimal CV data
(EDU=1, no EXP/PROJ/ACH — a pre-existing data gap unrelated to this change):

- Full evidence: 5 entries
- Planner/Writer/QR selected: 4 entries
- Finalizer selected: 4 entries (no repair auth in preflight)
- Fact Reviewer full evidence: 5
- High-priority evidence available: 3

Preflight result: `OPENAI CALLS: 0`, `DOCUMENT GENERATIONS: 0`. All
document-evidence-policy diagnostics PASS, including per-stage scope checks:
Planner == Writer == QR (4), Finalizer <= filtered (4), Fact Reviewer == full (5).
The single pre-existing FAIL ("Student evidence (CV core)") predates this
change and reflects the minimal CV data in this specific record.

## Visa SOP unrelated detail reduction: YES

VISA_SOP policy (tightened):
- HIGH: education, mastersMotivation, countryQuestionnaire, careerGoals,
  applicationData, programEvidence, visaEvidence, personalData
- MEDIUM: experience, fieldMotivation, facultyEvidence
- LOW (subject to maxItems): projects (≤1), achievements (≤1)
- EXCLUDE: research, publications, skills, certifications, personalStory,
  writingPreferences, recommenderContext

`maxItems` caps: experience ≤2, projects ≤1, achievements ≤1. The Writer does
not automatically receive every metric, project, skill, or achievement.
Skills, certifications, and personal story are EXCLUDED by default.

## SOP broad context preserved: YES

SOP keeps education, experience, projects, fieldMotivation, mastersMotivation,
careerGoals, programEvidence, facultyEvidence at HIGH. Skills/achievements/
certifications/countryQuestionnaire/research/publications at MEDIUM. SOP
selects 29/30 — broader than VISA_SOP (22/30). Document-specific selection does
not reduce SOP quality by over-filtering.

## LOR recommender perspective preserved: YES

LOR policy:
- HIGH: recommenderContext, officialRequirements, documentPrompt,
  consultantInstruction, personalData
- MEDIUM: education, experience, projects, achievements, applicationData
- EXCLUDE: countryQuestionnaire, visaEvidence, mastersMotivation, careerGoals,
  fieldMotivation, writingPreferences, recommenderContext-as-student-fact

LOR does NOT include: why-Germany answers, visa intentions, private country
answers, or unrelated employer achievements unless explicit recommender
context supports them. The recommender context (in application-specific facts)
is HIGH priority and always passes through.

## Diagnostic visibility

`renderDocumentEvidencePacketDiagnostics(packet)` renders a safe diagnostic
(IDs + categories only — no raw canonical text) for preflight/debugging:

```
Document Evidence Packet

Document Type: VISA_SOP
Full evidence: 30
Selected: 27
Excluded: 3

HIGH:
  SF-PERSONAL [personalData]
  SF-EDU-0 [education]
  ...

MEDIUM:
  ...

LOW:
  ...

EXCLUDE:
  ...
```

This is used by the zero-token preflight (`PREFLIGHT_VERBOSE=1`) and does not
expose sensitive raw evidence in normal UI.

## Zero-token preflight

`scripts/generation-preflight.ts` extended with per-stage diagnostics:

- `Document Evidence Policy: PASS` — type, selected/excluded/high counts
- `Selected evidence: <count>`
- `Excluded evidence: <count>`
- `High-priority evidence available: <count>`
- `Planner selected: <count>`
- `Writer selected: <count>`
- `QR selected: <count>`
- `Finalizer selected: <count>`
- `Fact Reviewer full: <count>`
- `Planner == Writer == QR base scope` — verifies shared filtered scope
- `Finalizer <= filtered/repair scope` — verifies finalizer does not exceed filtered
- `Fact Reviewer == full canonical ledger` — verifies full ledger retained

Missing optional evidence does NOT fail preflight.

## Files changed

- `src/lib/ai/document-evidence-policy.ts` (new) — central registry, classifier,
  packet builder, text formatter, filtered ledger view, diagnostics.
- `src/lib/ai/pipeline/run-application-pipeline.ts` — build packet after
  bundle; Planner/Writer/QR receive filtered packet; Fact Reviewer unchanged.
- `scripts/generation-preflight.ts` — document-evidence-policy diagnostics.
- `tests/document-evidence-policy.test.ts` (new) — 34 deterministic tests.

## Verification

- Typecheck: PASS
- Build: PASS
- Tests: 34/34
- OpenAI calls: 0
- Document generations: 0

## Finalizer relevance boundary

The Finalizer PROMPT receives only the document-specific filtered packet PLUS
repair-authorized evidence IDs from the action plan's `topicEvidence`. The full
canonical ledger remains stored internally for audit/checkpoints/provenance and
for the Final Fact Reviewer — but is NOT dumped into the Finalizer prompt.

`buildFinalizerLedgerView(packet, repairAuthorizedIds)`:
- Starts with the filtered packet entries (same scope as Writer/QR)
- Adds any repair-authorized evidence IDs from the action plan
- Preserves the original canonical `ledgerHash` (action-plan hash check passes)
- Repair-authorized IDs that are in the full ledger but not the filtered packet
  are added so `isLedgerEvidenceId` checks pass for authorized repairs

Expected architecture:

```
Planner   → filtered packet
Writer    → filtered packet
QR        → filtered packet
Language  → text + constraints
Finalizer → filtered / repair-relevant (NOT full ledger in prompt)
FactRev   → FULL canonical evidence
```

DOCUMENT-SPECIFIC EVIDENCE SELECTION IMPLEMENTED
