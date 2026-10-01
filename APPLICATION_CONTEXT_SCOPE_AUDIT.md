# APPLICATION-SCOPED INTAKE — ROOT AUDIT + MIGRATION DESIGN

Date: 2026-10-01
Scope: audit-first findings for cross-application contamination of intake fields.
OpenAI calls: 0. Production DB mutations: 0.

---

## 1. CURRENT STORAGE MAP (verified in code)

`students.profile_data` is ONE JSON blob holding every intake field.
`applications` has NO JSON/context column (`application_context_id`
VARCHAR(255) exists but is dead — nothing reads or writes it).
`application_documents` owns document requirement columns correctly.

| Field/group | DB table | JSON path / column | WRITE route | READ route | Intake section | Generation-context source | Reused across apps |
|---|---|---|---|---|---|---|---|
| personalData | students | profile_data.personalData | PUT /api/application/profile; POST cv-apply; POST /api/sop/generate (legacy) | GET /api/application/profile | 1 Student Details | adaptProfile → personalDetails | YES (correct — student fact) |
| education | students | profile_data.education | same | same | 1 | adaptProfile → education | YES (correct) |
| experience | students | profile_data.experience | PUT profile; cv-apply | GET profile | 4 | adaptProfile → experience | YES (correct) |
| projects | students | profile_data.projects | PUT profile; cv-apply | GET profile | 3 | adaptProfile → projects | YES (correct) |
| skills | students | profile_data.skills | PUT profile; cv-apply | GET profile | 3 | adaptProfile → skills | YES (correct) |
| achievements / certifications | students | profile_data.achievements (certs map to type="Certification") | PUT profile; cv-apply | GET profile | 3 | adaptProfile → achievements | YES (correct) |
| subjects | students | profile_data.subjects | PUT profile | GET profile | 3 Academics & Projects | adaptProfile passthrough | YES (correct — academic history) |
| mastersMotivation | **students** | profile_data.mastersMotivation | PUT profile | GET profile | 5 Master's Motivation | adaptProfile → mastersMotivation → SF-MOTIVATION-* evidence | YES — **CONTAMINATION** |
| countryQuestionnaire | **students** | profile_data.countryQuestionnaire | PUT profile | GET profile | 6 Country Questions | adaptProfile → countryQuestionnaire → SF-COUNTRY-* + visa evidence gate | YES — **CONTAMINATION** |
| careerGoals (structured) | **students** | profile_data.careerGoals{.shortTerm,.longTerm} | PUT profile | GET profile | 9 | adaptProfile → careerGoals + careerGoalsStructured → SF-CAREER-* | YES — **CONTAMINATION** |
| careerGoals (legacy flat keys whyField/whyProgram…) | **students** | profile_data.careerGoals.* | POST /api/sop/generate (legacy) | — | — | adaptProfile → careerGoals.* | YES — **CONTAMINATION** |
| fieldMotivation | **students** | profile_data.fieldMotivation | PUT profile | GET profile | 2 | adaptProfile → fieldMotivation (+ personalStory.motivation fallback) | YES — **CONTAMINATION** |
| subjectRequirements | **students** | profile_data.subjectRequirements | PUT profile | GET profile | 7 | adaptProfile passthrough | YES — **CONTAMINATION** |
| universityRequirements | **students** | profile_data.universityRequirements | PUT profile | GET profile | 8 | resolveAndMergePrompt — legacy documents only (use_legacy_requirements=TRUE) | YES — **CONTAMINATION** |
| application.* legacy blob (targetUniversity, sopQuestion, wordRequirement…) | **students** | profile_data.application | POST /api/sop/generate (legacy) | — | — | adaptProfile → profile.application | YES — **CONTAMINATION** |
| promptText / limits / topics / questions / formatting | application_documents | prompt_text, word_min, word_max, character_limit, page_limit, special_instructions, faculty_instructions, formatting_instructions, mandatory_topics, additional_questions | document create/edit routes | document routes | per-document UI (not intake) | resolveAndMergePrompt source DOCUMENT | NO (correct) |
| official requirements | writing_requirements (+ requirement_sets) | table rows | requirements resolver | — | — | source OFFICIAL_REQUIREMENT | NO (correct) |

**WRITE PATH ROOT CAUSE** — `intake/[step]/page.tsx` loads
`GET /api/application/profile?studentId=…` and PUTs the whole form to
`/api/application/profile` → `saveStudentProfileConditional` →
`students.profile_data`. The page is application-addressed in its URL but
the route is student-addressed; applicationId is never sent.

**READ PATH ROOT CAUSE** — `loadDocumentGenerationContext` does
`getStudentProfile(studentId)` → `adaptProfile` → all app-scoped fields
resolved from the shared blob. `checkVisaEvidence`, `getProfileReadiness`,
and `loadDocumentRequirementsForDisplay` read the same shared blob.

## 2. AUTHORITATIVE SCOPE MAP

```
STUDENT_SCOPE (reusable facts — entered once):
  personalData, personalDetails(legacy), education, englishTesting,
  englishProficiency(legacy), experience, projects, subjects, skills,
  achievements, research, publications, noWorkExperience, personalStory,
  stories, preferences, writingPreferences, factSheetApproval,
  projectClarifications, + unknown passthrough keys (default student)

APPLICATION_SCOPE (per-application motivation/context — entered once per app):
  fieldMotivation, mastersMotivation, countryQuestionnaire, careerGoals,
  subjectRequirements, universityRequirements, application (legacy blob)

DOCUMENT_SCOPE (per-document writing requirements — unchanged):
  promptText, promptSource, wordMin, wordMax, characterLimit, pageLimit,
  specialInstructions, facultyInstructions, formattingInstructions,
  mandatoryTopics, additionalQuestions, writingRequirement linkage
```

## 3. CONTAMINATION PROOF (deterministic, zero-token)

Reproduction (tests/application-context-scope.test.ts, test DB only):

  1. Student S; Application A (Germany MBA); Application B (USA MS).
  2. Save A's intake → students.profile_data.mastersMotivation = A-values.
  3. Save B's intake → same shared key overwritten with B-values.
  4. Resolve A's generation context → mastersMotivation = **B-values**.

Same mechanism for: mastersMotivation, countryQuestionnaire, careerGoals,
fieldMotivation, subjectRequirements, universityRequirements,
application.* legacy blob.

RESULT (pre-fix): CONTAMINATION CONFIRMED on all six audited groups.

## 4. TARGET STORAGE DESIGN

`applications` gains ONE JSON column + ONE version column (repository
style matches students.profile_data — no new tables):

  context_data JSON DEFAULT NULL
    shape: { fields: {<app-scoped keys>}, provenance: {<key>: SRC},
             seededAt, updatedAt }
  application_context_version INT NOT NULL DEFAULT 1
    1 = LEGACY (reads fall back to shared profile_data — identical to today)
    2 = APP_SCOPED (reads applications.context_data only; never falls back
        to shared app keys; writes never touch student scope)

  APPLICATION_CONTEXT_ID reported in preflight = applications.id
  (the context is owned by the application row itself).

## 5. LEGACY COMPATIBILITY + MIGRATION POLICY

- Existing rows get application_context_version=1 → reads resolve to
  shared profile_data exactly as today. Zero behavior change, zero data
  loss, no fabricated history.
- New applications are created with version=2 and empty context → they
  never inherit a previous application's values.
- First app-aware intake save on a v1 application auto-migrates it:
  seed context_data.fields from the CURRENT shared profile_data values
  marked LEGACY_SHARED, overlay the submitted fields
  (APPLICATION_EXPLICIT where they differ from the seed or are new),
  then set version=2. Future edits are fully application-scoped.
- HISTORICAL AMBIGUITY: profile_data only ever contained the LATEST
  shared value. For multi-application students, what application A "had"
  before B saved is unrecoverable. We do not fabricate it: seeding copies
  the single value that exists, marks it LEGACY_SHARED, and stops further
  contamination. This limitation is explicit, not hidden.
- Operator seeding script: scripts/migrate-application-contexts.ts —
  optional explicit bulk seed (same LEGACY_SHARED semantics) for
  operators who want all apps migrated without waiting for edits.

## 6. WRITE/READ PATH CHANGES

- GET /api/application/profile accepts optional applicationId → returns
  `profile` resolved per scope (v2: app fields from context_data; v1:
  shared values — the legacy fallback) + applicationContextVersion +
  applicationContextSource.
- PUT /api/application/profile accepts optional applicationId → splits
  the submitted profile: student-scope keys → students.profile_data
  (revision-conditional, existing app keys preserved verbatim);
  application-scope keys → saveApplicationContext (seed + overlay,
  version→2). Without applicationId the legacy behavior is unchanged.
- Intake page passes applicationId in GET and PUT — one-line change each;
  RHF/form semantics untouched.
- loadDocumentGenerationContext resolves the effective profile
  (student + current application context) before adaptProfile,
  visa/recommender checks, and the legacy universityRequirements merge,
  and exposes applicationContextId / applicationContextSource /
  crossApplicationFallbackUsed for the zero-token preflight.
- cv-apply: unchanged — it already writes only student-scope fields
  (personalData/education/experience/projects/skills/achievements) and
  preserves (never adds/modifies) other keys.
- Document requirement scope: untouched — prompt/limits/topics/questions
  stay on application_documents; use_legacy_requirements semantics
  preserved (legacy docs may still inherit the resolved application's
  universityRequirements).
