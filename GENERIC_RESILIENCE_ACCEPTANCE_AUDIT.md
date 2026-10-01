# GENERIC RESILIENCE ACCEPTANCE AUDIT

Audit-first pass over every remaining progression blocker in the D-Vivid
application writer. Zero paid calls, zero production mutations. Empirical
verification: `tests/resilience-acceptance.test.ts` (9/9) + prior suites.

## Fixes applied (confirmed unnecessary blockers, documented per §26)

| # | Fix | Evidence |
|---|---|---|
| 1 | "+ Add Document" ungated from 6-section intake completion | UI hid the button → documents unreachable on sparse profiles. Server never required intake for doc creation. `applications/[id]/page.tsx` |
| 2 | Generate button ungated from intake readiness; warning now advisory | `disabled={readinessBlocked}` made client stricter than its own `GENERATION_BLOCKED` server gate — no consultant override path existed. `documents/[id]/page.tsx` |
| 3 | CV-apply achievements get `cv-` provenance ids | `replaceCvDerived` filters on `cv-` prefix but pushed `randomUUID()` → CV-imported certifications/awards could never be removed. `cv-apply/route.ts` |
| 4 | Resilience test corrected to write `careerGoals` via `saveApplicationContext` (app-scope) | Test bug, not product bug: careerGoals is APPLICATION_SCOPE |

## Section verdicts

### 3. Application creation matrix — GENERIC ✅
Any country × degree × profile combination creates an application (test 3a: 7
countries × 6 degree types + generic/other all PASS). No country/course
assumptions in the create path.

### 4. Intake optionality — mostly sound
Work Experience satisfied by `noWorkExperience` (fresher path ✅). Required
sections are now **advisory only** post-fix. `cgpaScale` defaults "10" (editable
— mild assumption, non-blocking).

### 5. Zero-data ladder (verified live)
- Name only → `GENERATION_BLOCKED` with `MISSING_REQUIRED_STUDENT_INFORMATION` — intentional #5
- Name + education → **not blocked** (fact-sheet auto-approve) — server minimum is minimal
- Intake readiness stricter than server → now advisory-only

### 6–8. Document matrix — GENERIC ✅
All 11 types create + resolve prompts (test 6); per-doc prompts/limits/topics
isolated (test 8); doc-type gates only where data demands (LOR recommender,
Visa evidence).

### 7. Requirements variation — sound
Missing official prompt → consultant prompt/default template on every type.
Limits/topics/formatting all per-document optional fields.

### 9. Multi-application isolation — sound ✅
`applications.context_data` + scope stripping; 27/27 scope tests; CV-apply
writes student-scope only.

### 10. CV format matrix — GENERIC ✅
normal/table DOCX, normal/two-column PDF, scanned PDF (OCR), image-only DOCX
(OCR), fresher/academic/healthcare CVs, sparse → EXTRACTION_ONLY, corrupt →
FAILED_FILE. All verified in prior waves.

### 11. Mixed image/text OCR gap — **CLOSED** (final remediation)
`docx-image-inspect.ts` detects image-dominant DOCX structurally (≥1
content-sized image: ≥500px short side AND ≥400k px; <800 chars live text;
non-GOOD coverage). OCR output becomes an `OCR_TEXT_EXTRACTION` candidate —
plausibility ranking chooses, no merging. Mixed-PDF caveat documented in
REMAINING_DEAD_ENDS.md.

### 12. CV Apply residue — **CLOSED**
replaceCvDerived removes cv-id edu/exp/projects/achievements (achievements
id bug fixed) AND cv-tagged skills via `profile.skillProvenance` side map
(`mergeCvSkills`/`removeCvDerivedSkills` in `cv-merge.ts`). Manual skills
always preserved; absent provenance = manual. 8/8 provenance tests.

### 13–15. Preflight + pipeline — sound
Server gate = fact-sheet + doc-type evidence only. Stage failures split
TECHNICAL (bounded retry, checkpoint reuse, provider-response resume) vs
CONTENT (bounded regeneration). Fact review: provider failure → recovery;
contract-invalid → documented technical failure; unsupported claims →
repair/warn where safe.

### 16–17. COMPLETED_WITH_WARNINGS → review/download — sound
PREVIEW export always available; FINAL needs approval (intentional). Warnings
never gate editing/saving/versioning.

### 18. Error UX — adequate
Routes return human messages (`"Resume could not be read…"` pattern); codes
stay internal; GENERATION_BLOCKED reasons humanized with intake links.

### 19. Manual escape paths — all present ✅
CV fail → manual intake; requirement fetch fail → manual instructions; no
prompt → consultant/default template. No subsystem is the only path.

### 20–21. Dead ends + stale state — none remain hard
Permanent GENERATING/RECOVERING auto-recover via heartbeat+orphan claim;
FAILED has retry; all CV failures reach manual intake.

### 22. Consultant authority — preserved ✅
Partial CV → reviewable; consultant prompts accepted; warnings never block;
approve/edit/download always available once a draft exists.

### 23. Genericity — mostly clean
`cv-sanity` location lists, `narrative-profile` return-intent regex (mentions
"india" — advisory hint, non-blocking), `domain-verification` country domain
allowlists = conditional logic, not assumptions. No hardcoded
USA/Germany/MBA/full-time-work requirements in blocking paths.

## Blocker budget
- Inventory: ~24 blocker points → **7 intentional hard blockers** (see
  INTENTIONAL_HARD_BLOCKERS.md), 2 removed as unnecessary, remainder are
  transient/recoverable (B) or consultant decisions (D).
