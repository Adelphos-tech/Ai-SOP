# CV IMPORT — CANDIDATE RANKING AUDIT + PLAUSIBILITY FIX

## 1. PRE-FIX RANKING (audit of old `coverage.ts`)

`coverageRank(coverage)` composed:

```
tier            * 1_000_000
+ sectionCount  *    10_000
+ totalItems    *       100     ← raw structured record count
+ personalFields*        10
```

`chooseBestCandidate` iterated the strategy chain and replaced the winner
only on `>` — so earlier strategy order silently broke exact ties.

| Question | Pre-fix answer |
|---|---|
| What increased ranking | coverage tier, raw section count, raw item count, personal-field count |
| Did duplicates increase score | YES — every record counted positively |
| Implausible records penalized | NO — no plausibility concept existed |
| Malformed contact/date penalized | NO |
| Parser order tie-breaker | Implicit (iteration order), undocumented |
| Early exit | First `GOOD` candidate ended the chain — a bloated GOOD parse could never be compared against a cleaner later strategy |

**Root problem:** `totalStructuredItems * 100` gave raw volume real weight
inside a tier+section mix, and nothing penalized malformed/duplicate
records — a parser that over-segmented a CV into 21 "education" records
scored strictly better than one emitting 2 coherent records whenever
sections/tier were equal (and often even with fewer plausible fields).

## 2. POST-FIX MODEL

`diagnostics.ts` computes per-candidate `ResumeCandidateDiagnostics`
(counts only — no names/emails/employers/text):

- `personalCompleteness`, `invalidContactCount`
- `educationCount / plausible / duplicate / malformed`
- `experienceCount / plausible / duplicate / malformed`
- `skillsCount / uniqueSkillCount / suspiciousSkillCount`
- `certification / project / publication / achievement / language counts`
- `dateParseIssues`, `crossSectionPollutionCount`
- `rawTextLength`, `structuredCoverage` (sections with ≥1 usable item)
- `qualityRank` — deterministic composite:

```
tier                 * 1_000_000
+ structuredCoverage *   100_000
+ plausibleRecords   *     1_000   (plausible edu+exp+proj+cert+ach+pub+lang + unique skills capped 40)
+ validContactFields *       500
- malformedEdu/Exp   *     2_000
- duplicateEdu/Exp   *     1_500
- suspiciousSkills   *        50
- invalidContact     *       400
- pollution          *       300
- dateIssues         *       100
```

Plausibility = meaningful-field combinations (≥2 meaningful fields for
education; anchor org/role or bullets+structure for experience) — NOT all
fields required. Fresher (0 experience), academic (publication-heavy),
healthcare (PharmD/clinical skills) CVs are supported; no software-industry
assumptions.

**Early exit:** `isCleanlyGood` — a GOOD candidate stops the chain only
when it has zero malformed/duplicate/pollution/invalid-contact signals.
Bloated GOOD parses keep the chain running.

**Tie-break:** strictly `>` comparison, first-in-chain wins —
strategy order remains the final, weak prior.

**Partial result preservation:** winner stays a single canonical
candidate; sections present ONLY in losers are reported as
`secondaryOnlySections` (advisory, no unioning/Frankenstein merges).

## 3. OBSERVED RESULTS (`scripts/cv-candidate-diagnose.ts`)

| File | Winner | Why |
|---|---|---|
| KHUSHI .CV.docx | MAMMOTH_SEMANTIC | only structured candidate (docling = EXTRACTION_ONLY on table layout); 1 plausible edu, usable contact |
| Shivang .docx | MAMMOTH_SEMANTIC | clean 2p/1m edu, docling EXTRACTION_ONLY |
| Shivang .pdf | DOCLING_MAPPER | 2p/0m edu + 2p exp + 20 skills vs legacy 4p/17m edu + 11 dup |
| Kunj .pdf | DOCLING_MAPPER | 1p/0m edu + 3p exp vs legacy 9p/12m edu + 6 dup, 0 plausible exp |
| synth-twocol.pdf | DOCLING_MAPPER | higher quality rank |
| synth-healthcare.pdf | MAMMOTH_SEMANTIC | legitimately better structure — PDF prior correctly overridden |
| sparse.docx | DOCLING_MAPPER (EXTRACTION_ONLY) | no dead-end |
| corrupt/blank | FAILED_FILE | preserved hard-fail semantics |

## 4. NON-GOALS RESPECTED

No AI/LLM ranking, no OCR, no paid parser, no Mammoth/Docling rewrite,
no auto-merge of parser outputs, no CV-Apply or generation changes,
no new hard blockers (uncertain quality → PARTIAL_PARSE + review).
