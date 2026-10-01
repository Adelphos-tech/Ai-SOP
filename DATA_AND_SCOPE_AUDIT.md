# DATA AND SCOPE AUDIT

## 1. APPLICATION vs STUDENT SCOPE — confirmed storage reality

Architecture concern audited: app-specific intake data lives in
`students.profile_data` (student-scoped).

| Field | Correct scope | Actual storage | Risk |
|---|---|---|---|
| mastersMotivation | application | students.profile_data | cross-app contamination |
| countryQuestionnaire | application | students.profile_data | same |
| careerGoals | application | students.profile_data | same |
| universityRequirements | application | students.profile_data | same — different unis may need different answers |
| subjectRequirements | application | students.profile_data | same |
| fieldMotivation | application | students.profile_data | same |

Evidence: `intake/[step]` page POSTs these via `/api/application/profile`,
which persists to `students.profile_data`.

**Consequence (CONFIRMED):** two applications on one student overwrite each
other's app-scoped answers — last write wins silently. Evidence bundles may
therefore carry facts motivated for a different university.

**Mitigation already in place:** document-specific evidence selection +
document requirements; the generation contract pins evidence per document.
But the SOURCE data scope is wrong.

**Disposition:** ARCHITECTURAL issue (DB-001). Do NOT migrate now —
model-testing phase. Must be on pre-production checklist.

## 2. DATABASE TRANSACTION AUDIT

| Operation | Transactional? | Partial-write risk |
|---|---|---|
| student delete | yes — explicit tx | low |
| application delete | yes | low |
| document delete (deleteDocumentCascade) | yes — FOR UPDATE + ordered deletes | low — BUT misses RECOVERING guard (GEN-003) |
| CV apply | profile save revision-conditional | medium — skills merge unversioned; non-conditional fallback exists (CV-007) |
| generation start | run row + doc status sequential | narrow window — run created before doc GENERATING flip is consistent |
| generation complete | version insert → completeRun → doc status — sequential, NOT one tx | stray version row possible if crash mid-sequence (DB-003) |
| checkpoint creation | filesystem atomic write | safe — tmp+rename |
| document version creation | single insert | safe |

**Foreign keys:** generation_runs and generation_stage_responses have NO
FK to application_documents (DB-002). Cascade is hand-written SQL; any new
delete path must replicate it manually — already failed once (RECOVERING
enumeration).

## 3. requirements / prompt resolution — precedence matrix (verified)

For a document's generation context, resolver precedence is:

| Layer | Legacy doc (useLegacy=1) | New doc (useLegacy=0) | Default template | Official requirement | Explicit prompt |
|---|---|---|---|---|---|
| prompt text | document.prompt | resolved requirements | template default | official prompt | explicit field wins |
| word min/max | doc fields | resolved | template | official | explicit |
| page/char limit | doc fields | resolved | template | official | explicit |
| mandatory topics | doc | resolved | template | official | resolved |
| formatting | doc | resolved | template | official | resolved |
| consultant instructions | app-scoped (student profile — see §1) | same | same | same | same |

Cross-document bleed: NOT found — requirements resolve per-document via
documentId-scoped rows. `use_legacy_requirements` is NOT NULL DEFAULT 0 and
mapped strictly (`!!tinyint`); resolver receives required boolean.

## 4. useLegacyRequirements ambiguity audit

| Source | Can produce ambiguity? |
|---|---|
| DB value | NO — NOT NULL tinyint |
| repository mapping | NO — `!!row.use_legacy_requirements` |
| API object | NO — required field |
| resolver argument | NO — required boolean in ResolverDocumentInput |
| old rows | all migrated; spot-check found no NULL |
| manual test fixtures | PARTIAL — fixtures hand-constructing inputs could omit; type system catches it |

No ambiguity path found in production code.

## 5. FILE HANDLING — verified inventory

| Control | Status |
|---|---|
| DOCX validation | validateDocx — ZIP structure + required entries + zip-bomb check |
| PDF validation | %PDF magic bytes |
| extension validation | allowlist .pdf/.docx/.txt |
| size limits | 10MB hard cap + early Content-Length reject |
| hashing/dedup | SHA-256 per student; engine+version-pinned reuse |
| temp files | none — in-memory buffers; stored original by hash |
| stale parse reuse | pinned to pipeline version |

Crash/hang/exhaustion risk: bounded by cvParseLimiter + per-strategy
withTimeout (though timeout doesn't kill work — CV-003).

## 6. RENDERING / PUPPETEER — usage inventory

| Fact | Value |
|---|---|
| browser per render | fresh launch every call |
| renders per generation | 2-4 (pre-final + final + validation) |
| memory assumption | ~200-400MB per Chromium instance |
| timeout | page.setContent 30s |
| concurrency | renderLimiter cap |
| crash behavior | exception → warning path (RENDER_VALIDATION_REQUIRED), not hard fail |

Classification: **current-latency cost, future-scale risk** — acceptable at
model-testing volume; a pooled browser is the scale fix.
