# Form Reliability Root Fix — Phase 1

Date: 2026-09-19 · Source: `FORM_RELIABILITY_AUDIT.md` · 0 new packages · 0 AI changes

## Fixes

### P0 — Old-student data leak

**Stale-request protection (request tokens)** on all three ID-scoped loaders:

- `intake/[step]/page.tsx` — `loadTokenRef`; every async continuation checks `token !== loadTokenRef.current` before `setState`
- `students/[studentId]/page.tsx` — same pattern in `loadStudent`
- `students/[id]/applications/[id]/page.tsx` — same pattern in `loadApplication` (incl. nested requirements-lookup fetch)

**Identity-state reset** — on `studentId`/`applicationId` change the effect now clears `profile`, `application`, `documents`, `reqLookup`, `dirty`, `saveStatus`, `error`, `lastMissingSlugRef`, form-open flags *before* the new load starts. No student-A state can be observed under student B, even before the fetch resolves.

**CV state isolation** — `<CVUpload key={studentId}>` at both call sites (intake §1, application workspace). Parsed CV, review panel, applied banner, parseRevision — all remount per student.

### P1 — Wizard section swap while typing

`intake/[step]/page.tsx` — while `dirty`, the wizard holds `lastMissingSlugRef.current` (the section being edited) instead of re-selecting `missingRequired[0]` on every keystroke. Previously the guard only covered the all-sections-complete case; now a field completing its section never swaps the form. Navigation remains explicit-only: Save & Continue / Skip / Back links. `calculateIntakeCompletion` still runs live for progress UI — completion state no longer controls rendered section while editing. No nationality special-case — the fix covers every last-required field in every section.

### CV canonical mapping gaps

- **Parser** (`cv-parser.ts`): `skills.software` bucket added (design/analysis/engineering software split from `tools`); `nationality` extracted **only** from explicit `Nationality:`/`Citizenship:` labels (never inferred from name/address/phone/university); `certifications` + `achievements` extracted **only** from explicitly labelled sections (CERTIFICATIONS/CERTIFICATES/LICENSES, ACHIEVEMENTS/AWARDS/HONORS) — job bullets never promoted
- **Apply** (`cv-apply/route.ts`): `skills.software` merged via existing `mergeArrays` (append+dedupe, never overwrites manual entries); certifications+achievements → canonical `achievements[]` records (`type: "Certification"`/`"Award"`, dedupe by title); `personalData.nationality` flows through existing `mergePersonalData` fill-empty; `appliedFields` reports the new counts; revision 409-guard retained
- **Review UI** (`CVUpload.tsx`): nationality, certifications, achievements shown before Apply — nothing hidden is injected

## Static verification

| Check | Result |
|---|---|
| Pages with stale-request protection | 3 (intake, student, application) |
| Pages with identity-state reset | 3 |
| CVUpload student-scoped | YES (`key={studentId}`) |
| Wizard auto-navigation on onChange | NO (all `router.push` calls are in Save/Skip handlers) |
| Nationality special-cased | NO |
| Completion still live | YES |
| CV software mapping | YES |
| CV nationality (explicit-only) | YES |
| CV certifications | YES |
| CV achievements | YES |
| Revision guard retained | YES |
| Autocomplete attrs | `given-name`/`family-name`/`email`/`tel`/`bday`/`address-level2`/`country-name`; nationality = `name="nationality"` + `off` (no standard token; consultant enters applicant data) |

FILES CHANGED: `intake/[step]/page.tsx`, `students/[studentId]/page.tsx`, `applications/[applicationId]/page.tsx`, `CVUpload.tsx`, `cv-parser.ts`, `cv-apply/route.ts`, `test-real-cv-files.ts` (count update)

NEW PACKAGES: 0 · OPENAI CALLS: 0 · GENERATIONS: 0 · `tsc --noEmit`: clean

## Manual validation checklist (for user)

- **A. Student switch:** open A → quickly to B → no A values; back to A → correct
- **B. CV isolation:** parse CV for A → B → no preview; upload B CV → only B data
- **C. Nationality:** wizard Student Details → type "I-n-d-i-a" → section stays → Save → then next section
- **D. Other last-fields:** same for country/city/education
- **E. CV merge:** manual value survives; empty field + CV value → filled

STATUS: READY FOR USER MANUAL FORM VALIDATION
