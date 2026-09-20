# FRESH APPLICATION PREFILL — ROOT-CAUSE AUDIT

**Date:** 2026-09-20 · **Mode:** READ-ONLY · **Code changes:** 0
**Route:** `/students/65783a5e-c245-413d-b939-b6a3e244b593/applications/7989660b-bd70-4686-ac74-d08b71709de9/intake/missing`

---

## 1. EXACT RECORDS (production DB, read-only)

| Check | Result |
|---|---|
| Student record exists | YES — `65783a5e` = **shivang singh** (`shivangsingh516@gmail.com`), created 2026-09-14 14:33, updated 2026-09-20 08:23 |
| Application record exists | YES — `7989660b` = General / MBA / Germany / Spring / DRAFT, created **2026-09-19 19:44** |
| `application.student_id` = route studentId | **YES** — correct FK, no relation bug |
| Application is new | **YES** (newest of 4 applications on this student) |
| Student is new | **NO** — created 09-14; 3 prior applications (`iu uni`, `test` ×2) |
| How created | `POST /api/application/create` → `createApplication()` inserts metadata only |

## 2. THE CRITICAL FINDING — WRONG-PERSON PROFILE, NOT STALE STATE

`students` row columns: `first_name=shivang, last_name=singh, email=shivangsingh516@gmail.com`

`students.profile_data.personalData` (what the form renders):

```json
{ "firstName":"Kunj", "lastName":"Modh", "email":"kunjmodh99@gmail.com",
  "phone":"+91 9428235405", "currentCity":"Ahmedabad", "currentCountry":"India" }
```

**Kunj Manojkumar Modh is a DIFFERENT student** — `b27a7a16-ac81-4a6f-93d7-0692f3849a9c` (`kunjmodh99@gmail.com`, created 09-12, profile rev 22).

Provenance inside shivang's profile: array item IDs are `cv-1789395063595-*` / `cv-1789390687235-*` — **CV-apply generated IDs** (epoch-ms ~2026-09-18). Shivang's profile holds Kunj's CV content: 29 education rows (Indus University…), 2 experience rows (Business Analyst Sep 2023–Aug 2024), 17 projects, Kunj's skills.

## 3. MECHANISM — HOW KUNJ'S DATA LANDED IN SHIVANG'S PROFILE

`/api/application/cv-apply` merges `parsedCV` into `students.profile_data` **of the studentId in the request** — fill-empty merge (`overwrite=false` default). While viewing **shivang's** workspace, a consultant applied **Kunj's CV** (or otherwise saved Kunj's details). Shivang's profile was empty → every CV field filled in, including `personalData` identity fields. Profile `_revision` is now 8.

Code path: `cv-apply/route.ts` L84 `getStudentProfile(body.studentId)` → L91 `mergePersonalData(existing, parsed, overwrite)` → L258 `saveStudentProfileConditional`. The write is correctly student-scoped — **the wrong student was targeted**, which is a user/UX hazard, not a cross-student code bug.

## 4. WHY A "FRESH" APPLICATION SHOWS IT — STORAGE MODEL

```
students.profile_data  ← ONE canonical profile per student (JSON, rev-guarded)
applications           ← NO profile column — only uni/program/country/intake metadata
```

`createApplication()` copies **zero** profile data (`application-repository.ts:243-270`). The intake page loads `GET /api/application/profile?studentId=…` → `getStudentProfile()` → `reset(profile)` — the **student-level** profile, shared by all 4 of shivang's applications. Prefill on a new application is **the designed behavior** (Option A: student-profile reuse).

Copy audit — new application copies: personalData NO · education NO · experience NO · projects NO · skills NO · motivation NO · country answers NO · university answers NO · career goals NO · document requirements NO. (Nothing copied at creation — the form simply reads the shared student profile.)

## 5. APPLICATION-SPECIFIC LEAK CHECK

shivang's `profile_data` top-level keys: `personalData, education, experience, projects, skills, _revision` only. `countryQuestionnaire`, `mastersMotivation`, `careerGoals`, `universityRequirements`, `subjectRequirements`, `fieldMotivation` — **absent** → **NOT LEAKED** for this application.

⚠ However, all of those fields are stored **inside the student-level `profile_data`** — so when populated they DO bleed across applications of the same student (mixed-scope model, see §8).

## 6. OTHER SOURCES — RULED OUT

| Source | Verdict |
|---|---|
| Previous application data copied | NO — applications carry no profile data at all |
| RHF stale state | NO — `reset(data.profile)` only; identity change → `reset({})` + guarded reload; `student` row fields are never injected into the form |
| Stale async response | NO — `loadTokenRef` intact; a late response cannot call `reset()` |
| `ProfileContext`/localStorage | NO — provider exists in layout but intake page doesn't consume it; it only reads `?studentId=` query param (absent on this route) and can't write into RHF |
| Browser autofill | NOT RELEVANT — DB explains every value; consultant's autofill couldn't know Kunj's data |
| `adaptProfile` legacy fallback | NO — only called in `generation-service.ts` (AI evidence mapping), never in the intake load path |
| Wrong `application.student_id` | NO — FK matches |

## 7. FIELD-BY-FIELD PROVENANCE

| Field | Displayed | Source |
|---|---|---|
| First Name | Kunj | `students.profile_data.personalData.firstName` (CV apply ~09-18) |
| Last Name | Modh | same |
| Email | kunjmodh99@gmail.com | same |
| Phone | +91 9428235405 | same |
| Nationality | (Indian if shown) | same / CV nationality extraction |
| City | Ahmedabad | same |
| Country | India | same |
| Education | 29 rows | same — `cv-*` ids |
| Experience | 2 rows | same |
| Projects | 17 rows | same |
| Skills | Kunj's skill set | same |

## 8. SCOPE-MODEL AUDIT (field categories)

| Category | Status |
|---|---|
| personalData, education, experience, projects, skills, achievements | CORRECTLY STUDENT-SCOPED (design intent) |
| mastersMotivation, countryQuestionnaire, careerGoals | **AMBIGUOUS / INCORRECTLY SHARED** — stored in student profile → reused across all applications of that student |
| universityRequirements, subjectRequirements, fieldMotivation | **INCORRECTLY SHARED** — application/program-specific data lives student-scoped |
| `students.first_name/email` columns vs `profile_data.personalData` | **INCONSISTENT** — two identity sources, never reconciled; UI header shows "shivang" while the form shows "Kunj" |

## 9. VERDICT

```
IS THIS A BUG: PARTIAL

  (a) Application shows student's stored profile on a new application
      → EXPECTED BEHAVIOR (student-scoped canonical profile; Option A).

  (b) The stored profile contains ANOTHER PERSON's data (Kunj inside
      shivang's row) → P1 DATA-INTEGRITY ISSUE. Most likely a consultant
      applied Kunj's CV while on shivang's workspace; cv-apply correctly
      targeted the open studentId. Not a cross-student code bug, but
      the product allowed a silent identity overwrite of an empty profile.

  (c) Students row columns and profile_data.personalData diverge
      permanently (PUT only writes profile_data) → P1 consistency gap:
      header/list says "shivang", form says "Kunj".

  (d) Application-scoped sections stored inside student profile_data
      → P1 design gap: they will bleed into every future application
      of the same student.
```

## 10. PROPOSED FIXES (NOT IMPLEMENTED)

- **CV-apply identity guard (P1):** if `parsedCV.personalData.name/email` conflicts with the student row's identity, warn before merge ("This CV appears to belong to Kunj Modh, not shivang singh").
- **Identity reconciliation (P1):** on profile PUT, sync `students.first_name/last_name/email` from `personalData` — or render identity from `personalData` everywhere so columns aren't authoritative for display.
- **Scope split (P1, bigger):** move `mastersMotivation / countryQuestionnaire / careerGoals / universityRequirements / subjectRequirements / fieldMotivation` to an application-scoped store (e.g., `applications.profile_overrides` JSON) with student profile as fallback — enables per-application answers.
- **UX label:** mark prefilled sections "Reused from student profile".
- **Remediation for this record:** reset `personalData` (and CV-sourced arrays) on `65783a5e` if it should be shivang — or rename the student row to Kunj if it is effectively his.

## REPORT

```
STUDENT: 65783a5e — "shivang singh" (row) / profile contains "Kunj Modh"
APPLICATION: 7989660b — General/MBA/Germany, created 2026-09-19
APPLICATION IS NEW: YES
STUDENT IS NEW: NO

VISIBLE PERSONAL DATA SOURCE: students.profile_data (CV-apply of Kunj's CV, ~09-18)
STUDENT PROFILE REUSE: YES
PREVIOUS APPLICATION DATA REUSE: NO (no app-level profile exists)
WRONG STUDENT DATA: PARTIAL — profile JSON belongs to this student row but holds another person's identity
RHF STALE STATE: NO
STALE ASYNC RESPONSE: NO
BROWSER AUTOFILL: NO
APPLICATION-SPECIFIC LEAK: NO (none stored yet)

ACTUAL STORAGE MODEL: one student-scoped profile_data JSON; applications hold metadata only
EXPECTED BEHAVIOR: Option C — reuse student facts, keep application answers blank, label reused data

ROOT CAUSE: Kunj's CV was applied to shivang's student profile; the student-scoped
profile then legitimately prefilled every application. Identity columns and
profile_data.personalData are divergent and never reconciled.

P0: none — no cross-student DB leak; FK integrity holds
P1: (b) CV-apply can silently overwrite a student's identity with another person's CV
    (c) student columns vs personalData divergence
    (d) application-scoped sections stored student-scoped

OPENAI CALLS: 0 · DOCUMENT GENERATIONS: 0 · CODE CHANGES: 0
```

FRESH APPLICATION PREFILL ROOT CAUSE AUDIT COMPLETE
