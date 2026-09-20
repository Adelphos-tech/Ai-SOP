# CV IDENTITY SAFETY + STUDENT IDENTITY CONSISTENCY FIX

**Date:** 2026-09-20
**Source:** `FRESH_APPLICATION_PREFILL_AUDIT.md` — proven incident: Kunj Modh's CV (`b27a7a16`) applied into shivang singh's profile (`65783a5e`), silently rewriting the canonical identity.

## WHAT CHANGED

### 1. CV identity guard — `src/lib/application/identity-check.ts` (new)

`classifyIdentityMatch(studentRow, parsedCV.personalData)` — compares the CV's explicit identity evidence against the **students row** (`first_name`/`last_name`/`email`), never the potentially-corrupted `profile_data.personalData`. Normalization: trim, collapse whitespace, lowercase.

Statuses:

| Evidence | Status |
|---|---|
| Both emails present + equal | `MATCH` |
| Both emails present + different | `CONFLICT` (strongest signal) |
| Names present + equal or token-contained (`"Kunj Modh"` ⊆ `"Kunj Manojkumar Modh"`) | `MATCH` / `PARTIAL_MATCH` |
| Names present + divergent (`"Shivang Singh"` vs `"Kunj Modh"`, or same first name + different surname) | `CONFLICT` |
| CV carries no usable name/email | `INSUFFICIENT_IDENTITY` — never treated as a different person |

Phone/address/nationality/university/employer are never used for ownership.

### 2. cv-apply enforcement — `cv-apply/route.ts`

- `CONFLICT` → **409 `CV_IDENTITY_CONFLICT`** with `studentIdentity` + `cvIdentity` (name/email only — no CV contents)
- Merge only proceeds with explicit `identityConflictOverride: true`; overrides emit an audit log line (studentId, identities, consultant id — no CV content)
- Revision guard (`PROFILE_CHANGED` 409 + conditional write) unchanged

### 3. CVUpload UX — `components/ui/CVUpload.tsx`

- Review panel now always shows **Selected student** vs **CV belongs to** (name + email) before Apply
- On `CV_IDENTITY_CONFLICT`: red banner *"This CV appears to belong to a different person."* + clear message naming both identities; the default Apply is replaced by **"Apply Anyway (I verified the identity)"** — a separate explicit second click
- State cleared on reset/new upload; `key={studentId}` isolation retained

### 4. Student-row ↔ personalData reconciliation — `application-repository.ts` + `profile/route.ts`

`saveStudentProfileConditional()` accepts an optional `identitySync` — when the consultant's explicit profile save carries non-empty `personalData.firstName/lastName/email`, the same transaction updates `students.first_name/last_name/email`. Atomic: profile write + identity write commit or roll back together.

**CV apply does not pass `identitySync`** — a parsed CV can never rename the student row. Identity editing remains a deliberate Student Details action.

## STATIC VERIFICATION (deterministic, no uploads)

| Case | Student | CV | Result |
|---|---|---|---|
| A | Shivang Singh / shivang@x.com | Kunj Modh / kunj@x.com | **CONFLICT** — apply blocked pending explicit action ✓ |
| B | Shivang Singh / shivang@x.com | Shivang Singh / shivang@x.com | **MATCH** — normal apply ✓ |
| C | Shivang Singh | Shivang Singh (no email) | **PARTIAL_MATCH** — not CONFLICT ✓ |
| D | Shivang Singh | no name/email | **INSUFFICIENT_IDENTITY** ✓ |
| E | Kunj Manojkumar Modh | Kunj Modh | PARTIAL_MATCH (middle-name containment) ✓ |
| F | Shivang Singh | Shivang Patel | CONFLICT (surname diverges) ✓ |

## REPORT

```
IDENTITY GUARD: IMPLEMENTED YES
MATCH STATES: MATCH / PARTIAL_MATCH / INSUFFICIENT_IDENTITY / CONFLICT
EMAIL CONFLICT DETECTED: YES
NAME CONFLICT DETECTED: YES (token-containment aware — middle names/initials safe)
WRONG-PERSON CV SILENT APPLY: NO — 409 until explicit override
EXPLICIT OVERRIDE: YES — separate "Apply Anyway (I verified the identity)" click
                   sends identityConflictOverride:true; server logs audit metadata
STUDENT ROW / PERSONALDATA RECONCILIATION: explicit profile saves now sync
                   first_name/last_name/email atomically inside the conditional
                   save transaction (non-empty values only)
CV CAN SILENTLY RENAME STUDENT ROW: NO — cv-apply never passes identitySync
REVISION GUARD RETAINED: YES
RHF ARCHITECTURE CHANGED: NO
TANSTACK INSTALLED: NO
APPLICATION-SCOPE MIGRATION: NOT PERFORMED — follow-up note:
                   mastersMotivation / countryQuestionnaire / careerGoals /
                   universityRequirements / subjectRequirements / fieldMotivation
                   remain student-scoped and will bleed across applications of the
                   same student. Needs a dedicated application-scoped store
                   (e.g. applications.profile_overrides + merge precedence).

SHIVANG RECORD MODIFIED: NO

REMEDIATION PREVIEW (student 65783a5e — requires manual approval):
  LIKELY CV-DERIVED (Kunj): personalData (all fields), education[29 cv-* rows],
      experience[2 cv-* rows], projects[17 cv-* rows], skills (CV-merged arrays)
  AMBIGUOUS: none — every populated field carries Kunj's identity or cv-* ids
  LIKELY SHIVANG DATA: none identified in profile_data
  Suggested action (manual): clear CV-derived keys OR reassign the student row
      identity to Kunj if this record is effectively his.

OPENAI CALLS: 0
DOCUMENT GENERATIONS: 0
```

CV IDENTITY SAFETY FIX DEPLOYED — EXISTING CORRUPTED RECORD REQUIRES MANUAL REMEDIATION
