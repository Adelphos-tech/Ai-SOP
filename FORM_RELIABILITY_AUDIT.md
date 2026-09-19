# Form Reliability + CV Field Mapping Audit

Date: 2026-09-19 · Read-only audit · 0 code changes · 0 AI calls

## 1. Form surface inventory

| Surface | Route | Fields | State source | Save | Form lib |
|---|---|---|---|---|---|
| New applicant | `/students/new` | 12 (student + first application) | `useState` × 12 | POST × 2 then redirect | none |
| Student detail | `/students/[id]` | 8 (new-application inline form) | `useState` + fetch | POST | none |
| Application workspace | `/students/[id]/applications/[id]` | doc-create form (~8) | `useState` + fetch | POST | none |
| **Intake (9 sections)** | `intake/[step]` | ~60 fields across 9 sections | **single `profile` object in useState** | PUT `/api/application/profile` (revision-conditional) | none |
| Missing-info wizard | `intake/missing` | same profile object | same | same | none |
| CV upload | inside intake §1 | file + review | `useState` parsedCV | POST cv-upload → cv-apply | none |
| Search | `/students` | query | `useState` | GET | none |

All forms are **custom `useState` + manual onChange**. No form library, no validation library, no query library. One `<form>` element total (student search); all other saves are `onClick` handlers — no implicit-submit class of bugs found.

## 2. Root causes

### A. Nationality first-character "jump" — P1 NAVIGATION UX

**File:** `intake/[step]/page.tsx:226-241` + field at `:486`

**Event chain:**
```
keystroke in nationality
→ setPd("nationality", "I")
→ updateProfile → setProfile (new object)
→ re-render
→ calculateIntakeCompletion(profile) — live in-memory
→ student-details flips missing → complete
→ missingRequired[0] becomes the NEXT missing section
→ wizardSection = that section → renderSection swaps the form
→ user sees "jumped to next step" mid-typing
```

The `dirty` guard added in `5fe6e80` only covers `missingRequired.length === 0` (all done). When the current section completes but **other** sections remain missing, `wizardSection` re-selects immediately — the guard never engages. **The fix is `intake/[step]/page.tsx` only:** while `dirty` in wizard mode, prefer `lastMissingSlugRef.current` (the section being edited), not just when `wizardSection === null`.

### B. Old-student data reappearing — P0 DATA LEAK

Two mechanisms:

1. **Async race** (`intake/[step]/page.tsx:70-100`, `students/[id]/page.tsx:69+`, `applications/[id]/page.tsx:112+`): `useEffect(loadAll, [studentId])` fires a new fetch but never aborts/expires the in-flight one. Switch A→B quickly: B's `Promise.all` resolves, then A's resolves later → `setProfile(A)` while viewing B. No request-token/AbortController anywhere.
2. **State never reset on ID change:** `profile`, `dirty`, `saveStatus`, `application`, `lastMissingSlugRef` (and inside `CVUpload`: `parsedCV`, `applied`, `filename`, `parseRevision`) all survive a studentId/applicationId switch — Next.js reuses the mounted page component across dynamic-segment changes. `loading` gates the render during fetch, but `dirty`/`lastMissingSlugRef` from student A persist into student B's wizard (can pin the wrong section or mark unsaved changes on fresh data). **A parsed CV result for student A stays visible on student B's page** until reload.

Browser autofill: no `name`/`autocomplete` attributes on inputs → possible secondary contributor for name/email/country, but the primary leak is application state.

### C. CV incorrect field population — P1

Parser (`cv-parser.ts`, 717 LOC): rule-based regex extraction — pdf-parse + mammoth. No OCR (image PDFs → clean `IMAGE_ONLY_PDF` rejection ✓), no two-column awareness, no header/footer dedup → **extraction quality is the weak link**, not the merge.

Mapping (`cv-apply/route.ts`): canonical destinations are correct — `personalData` (via `mergePersonalData`, fill-empty), `education`, `experience`, `projects`, `skills`. Dedupe by institution+degree / org+role / name. No aliases in use. **Gaps:**
- `skills.software` exists in the profile form but is **never populated from CV** (route sets `software: existingSkills.software || []` — parsed skills never map into it).
- `certifications`, `achievements`, `languages` — not extracted at all (parser doesn't produce them; ParsedCV interface lacks them).
- Merge policy: fill-empty on scalars, append-dedupe on arrays — correct and revision-guarded (409 on stale `profileRevision` ✓).
- `personalData.nationality` IS in `PERSONAL_KEYS` but the parser's `personalData` type doesn't extract nationality → CV never fills it.
- CV does NOT infer motivation/goals/preferences ✓ (parser only emits what it finds).

## 3. Other findings

- **Controlled inputs:** all inputs controlled (`value={x || ""}`) — no mixed controlled/uncontrolled issues. List keys use stable `crypto.randomUUID()` ids ✓.
- **Global key handlers:** only `UniversitySelect` (scoped, correct combobox pattern) + error boundary. No wizard-level keydown. Enter key inside non-form context can't submit (no `<form>`).
- **Buttons:** no `<button>` missing `type` inside a `<form>` — only one form exists.
- **CV dedup:** SHA-256 file-hash reuse scoped per-student directory ✓ — but UI `parsedCV` state is not student-scoped (see B2).
- **Conditional save:** profile PUT uses `expectedRevision` — 409 → reload + message ✓ good.
- **Readiness side effects:** completion derives from live in-memory profile — this is exactly what causes the nationality jump; the same mechanism can swap sections for ANY last-missing field of a section (city, country, education…).

## 4. Library recommendations (evidence-based)

| Library | Verdict | Surface |
|---|---|---|
| React Hook Form + Zod | YES — the intake page is ~1000 LOC of hand-rolled field state; RHF gives dirty/touched/reset for free | intake page + students/new first |
| TanStack Query | YES — kills the A→B race class (query keys scope by studentId automatically; stale responses discarded) | profile/application/document reads |
| Custom combobox | NO replacement needed — UniversitySelect is a correct, accessible combobox already | — |
| Pino/axios/etc | no | — |

## 5. Implementation order

1. **Wizard section-swap fix** (nationality class) — hold `lastMissingSlugRef` while `dirty`; covers every last-field-of-section
2. **Student-switch reset** — `key={studentId}` on the page subtree (or explicit reset in the effect) + request-token guard on `loadAll`; reset `CVUpload` state on `studentId` change
3. **CV mapping gaps** — parser: extract nationality/certifications; route: map `software`; optionally surface unmapped CV data in review
4. RHF migration (intake → students/new) · TanStack Query for profile/application/document reads — after bugs, not before

## Report

FORM SURFACES AUDITED: 7 · CUSTOM INPUT COMPONENTS: 2 (FormField, UniversitySelect) · STALE-STATE RISKS: 4 · ASYNC RACES: 3 · NAVIGATION BUGS: 1 (wizard section-swap — affects all sections) · CV MAPPING ISSUES: 3

**OLD STUDENT DATA ROOT CAUSE:** un-aborted `loadAll` fetches resolving out of order + page-component state (`profile`, `dirty`, `lastMissingSlugRef`, `CVUpload.parsedCV`) surviving dynamic-segment switches.

**NATIONALITY JUMP ROOT CAUSE:** wizard derives `missingRequired` from live in-memory profile every render; completing the section's last field swaps `wizardSection` mid-typing. `dirty` guard only handles the all-complete case (`5fe6e80` partial fix).

**CV FIELD POPULATION ROOT CAUSE:** rule-based parser quality (no OCR, no column awareness) + incomplete canonical mapping (`software` never mapped; `nationality`/`certifications`/`achievements` never extracted).

RHF: YES · Zod form schemas: YES (reuse after Zod already installed) · TanStack Query: YES · Combobox replacement: NO

**P0:** A→B data leak (race + state survival) · **P1:** wizard section-swap on last-field keystroke · CV `software`/`nationality` mapping gaps

**PACKAGES LATER:** react-hook-form, @tanstack/react-query · **NOT NEEDED:** combobox lib, extra validation lib

OPENAI CALLS: 0 · GENERATIONS: 0 · CODE CHANGES: 0

FORM + CV RELIABILITY AUDIT COMPLETE — READY FOR ROOT FIXES