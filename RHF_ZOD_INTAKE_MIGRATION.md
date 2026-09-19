# REACT HOOK FORM + ZOD — INTAKE FORM MIGRATION

**Date:** 2026-09-20
**Scope:** `/students/{studentId}/applications/{applicationId}/intake/{step}` — all 9 intake sections
**Out of scope (unchanged):** server fetching architecture, APIs, persistence format, readiness semantics, wizard navigation semantics, CV merge rules, routes, `/students/new`, application/document forms, AI pipeline.

---

## ARCHITECTURE

```
server fetch (existing, unchanged)
   ↓  token-guarded
normalized canonical profile
   ↓  form.reset(profile)         ← single editable state owner
React Hook Form (FormProvider)
   ↓  register / Controller / useFieldArray
getValues()/handleSubmit → same canonical PUT payload
   ↓  success → reset(values) → isDirty=false
```

- **One root form:** `useForm<IntakeProfileForm>({ resolver: zodResolver(IntakeProfileSchema), mode: "onBlur" })` — `src/app/students/[studentId]/applications/[applicationId]/intake/[step]/page.tsx`
- **Form schema layer:** `src/lib/forms/intake-profile.schema.ts` — separate from AI-output schemas; structural validation only, all fields optional (draft semantics), `.passthrough()` so unregistered canonical fields (linkedin, `_revision`, publications…) survive the `getValues()` → PUT round trip.
- **Field arrays:** `useFieldArray` for `education`, `projects`, `subjects`, `experience`, `subjectRequirements.notes` — `keyName="_key"`; existing UUID `id`s preserved via hidden registered inputs.
- **Controlled custom components:** `Controller` wraps `TextAreaField`, the country select, and comma-separated skill-list inputs.

## INVARIANTS PRESERVED

- **FIELD CHANGE != NAVIGATION** — `isDirty` keeps `lastMissingSlugRef`'s section mounted while typing; every `router.push` sits inside explicit Save/Skip handlers. Typing `I-In-Ind-India` in Nationality never swaps sections.
- **Stale-request token** — a superseded fetch cannot call `reset()`; student A's late response cannot touch student B's form.
- **Identity reset** — on `studentId`/`applicationId` change: form cleared (`reset({})`), revision/application/status/error/`lastMissingSlugRef` all cleared, then fresh load.
- **Revision guard** — `expectedRevision` PUT; 409 → reload + visible message + navigation blocked.
- **CV flow** — `CVUpload key={studentId}` unchanged; Apply → save dirty edits first → `loadAll()` → `reset(server canonical profile)`. CV parser/merge untouched.
- **Completion stays live** — `watch()` feeds `calculateIntakeCompletion`/`getProfileReadiness` for progress UI only; it does not drive section selection while dirty.
- **Required/optional rules** — unchanged: required = Student Details, Academics & Projects, Work Experience (or no-experience), Master's Motivation, Country Questions, Career Goals; optional = Field Motivation, Subject Requirements, University Requirements.
- **Validation UX** — `mode: "onBlur"`; invalid email shows a field error via `formState.errors` and blocks save-through-submit, never navigates.

## STATIC VERIFICATION

| Check | Result |
|---|---|
| manual editable profile `useState` removed | YES — `profile`/`setPd`/`updateProfile`/`setMm`/`setCountry`/`updateEducation`/`updateProject`/`updateSubject`/`updateExp`/`setShort`/`setLong`/`setUr`/`addNote`/`updateNote`/`removeNote`/`setFieldMotivation` all deleted |
| RHF owns unsaved form state | YES |
| Zod resolver active | YES — `zodResolver(IntakeProfileSchema)` |
| student/application switch reset | YES |
| stale request protection retained | YES — `loadTokenRef` guards every `reset`/`setState` |
| revision guard retained | YES — `expectedRevision` + 409 reload |
| wizard field mutation navigates | NO |
| Nationality typed without navigation | architecture YES |
| CV Apply resets from canonical server profile | YES — `saveProfile(dirty)` → `loadAll` → `reset(profile)` |
| required/optional section rules unchanged | YES |

## MANUAL USER VALIDATION CHECKLIST

- [ ] **A. Nationality** — reach Student Details as a missing section; type `India` one character at a time; section must not change; Save & Continue moves on.
- [ ] **B. Dirty state** — edit a field → "Unsaved changes" shows; save → indicator clears.
- [ ] **C. Student A → B** — no Student A fields appear in Student B; back to A shows correct A values.
- [ ] **D. Validation** — invalid email → field error under the input, no navigation; fix → save succeeds.
- [ ] **E. Arrays** — add/edit/remove education, experience, projects; values stay stable across edits.
- [ ] **F. Save/reload** — save a section, refresh, same values return.
- [ ] **G. CV** — upload/apply a CV; form updates from the canonical saved profile; manually entered values win over CV values.

## REPORT

```
REACT HOOK FORM VERSION:
7.88.0

RESOLVER VERSION:
@hookform/resolvers 5.9.1

ZOD VERSION:
3.25.76

INTAKE SECTIONS MIGRATED:
9/9

MANUAL PROFILE FIELD STATE REMOVED:
YES

USEFORM:
YES

FORMPROVIDER:
YES

USEFIELDARRAY:
YES (education, projects, subjects, experience, subjectRequirements.notes)

ZOD RESOLVER:
YES

STALE REQUEST GUARDS RETAINED:
YES

STUDENT ID RESET:
YES

APPLICATION ID RESET:
YES

REVISION GUARD:
YES

FIELD CHANGE CAN NAVIGATE:
NO

CV APPLY INTEGRATION:
dirty-save → loadAll → reset(server canonical profile); merge rules unchanged

CANONICAL PROFILE/API FORMAT CHANGED:
NO

TANSTACK QUERY INSTALLED:
NO

OPENAI CALLS:
0

DOCUMENT GENERATIONS:
0

STATUS:
READY FOR USER MANUAL FORM VALIDATION
```

RHF + ZOD INTAKE MIGRATION DEPLOYED — MANUAL VALIDATION REQUIRED
