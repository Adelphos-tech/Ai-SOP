# UX Release Audit — PHASE RELEASE-40

Date: 2026-09-17
Scope: canonical consultant workflow pages, request/response contracts, HTTP semantics, error UX, responsive layout, async states.

## Executive summary

The customer's complaint — **"I can't go to Intake and then Document"** — was reproduced and root-caused to a **composition of three server bugs**, all now fixed:

1. `POST /api/requirements/resolve-prompt` returned **400** when `intake`/`intakeYear` were empty — but those fields are optional at application creation, and the customer's newest application had them empty.
2. `POST /api/application/document` returned **403** for `DVIVID_DEFAULT_TEMPLATE` prompts (the most common resolve-prompt outcome) and **500** for `OFFICIAL_VERIFIED` prompts — so *only manually typed prompts could ever create a document*.
3. `POST /api/application/document/generate` returned **403** for business-incompleteness (should be 422) and the UI discarded the `blockReasons` it returned.

A fourth critical bug was found in export: the Final PDF/DOCX buttons passed a **stale React state `versionId`** → 400 every time.

## Issues found & fixed

### CRITICAL (all fixed)

| # | Issue | Fix |
|---|-------|-----|
| C1 | `POST /api/application/document` rejected `DVIVID_DEFAULT_TEMPLATE` (403) and `OFFICIAL_VERIFIED` (500) — the two main resolve-prompt outcomes. Document creation was impossible for resolved prompts. | Route now uses `createOfficialDocument()` with verification: `OFFICIAL_VERIFIED` requires an existing `writingRequirementId` matching the document type; `DVIVID_DEFAULT_TEMPLATE` is verified by comparing `promptText` against the server template; edited template text is stored as `CONSULTANT_PROVIDED`. |
| C2 | Final export buttons passed stale `selectedVersion` (React state flush race) → 400 every time. | `handleExport` accepts an explicit `versionId`; final buttons pass `approvedVersion.id`. |
| C3 | Required intake section "Work Experience" was uncompletable for freshers (no "N/A" option) → intake could never reach `canGenerate`. | Added a "no work experience" checkbox writing `profile.noWorkExperience`; `intake-completion.ts` treats it as complete. |

### HIGH (all fixed)

| # | Issue | Fix |
|---|-------|-----|
| H1 | Document workspace had no pre-generation readiness display; Generate was clickable and its failure hid the real reasons. | Added a readiness panel before the Generate button (reuses `getProfileReadiness`); Generate is disabled with per-section links when blocked; `blockReasons`/`completenessIssues` are rendered from the 422 response. |
| H2 | Two contradictory readiness gates (UI `getProfileReadiness` vs server gate in `generation-context`). Plus "Add First Document" showed even when intake incomplete. | Empty-state button now routes to intake when incomplete. Server gate still enforced independently (by design: server is authoritative). |
| H3 | Student workspace read `personalDetails.*`; intake writes `personalData.*` — completion % always wrong. | Fixed to `personalData` (+ `noWorkExperience` for Experience pill). |
| H4 | No intake→document navigation inside intake; invalid step slug was a dead end; last-section button didn't say it exits. | Added "Exit to application" link; invalid-slug state now links back; last section button reads "Save & Finish →". |
| H5 | Workspace CTA bugs: `APPROVED` unreachable (shadowed by `GENERATED` branch); `GENERATING`/`FAILED` produced no CTA; `IN_REVIEW` was checked as a generationStatus (dead). | Reordered CTA priority (APPROVED > GENERATED > GENERATING > FAILED > NOT_STARTED); added "Generation in Progress" and "Retry Generation" CTAs; most-advanced-document selection. |

### MEDIUM (fixed)

- Intake save errors showed **raw JSON** (`{"error":"…"}`) — now parses `error`/`message`.
- Students page rendered the **empty-state** on any fetch error — now shows a real error + retry.
- "Unsaved changes" indicator showed on first load and after save — now only when actually dirty.
- `AuthGuard` logout called nonexistent `/api/auth/logout` → now calls `POST /api/auth/session`.
- Document workspace showed no state for a persisted `GENERATING` status after reload (dead end) — now shows an "in progress" card + refresh; `FAILED` shows a retry card.
- Document workspace had no **Regenerate** path once versions existed — added "Regenerate with AI".
- Search placeholder claimed "student ID" search which doesn't exist — corrected copy.
- Dead `import { randomUUID } from "crypto"` in a client component — removed.
- `checkVisaEvidence` read only legacy keys the canonical intake never writes (VISA_SOP permanently unblockable) — now reads canonical `careerGoals.longTerm.*`/`countryQuestionnaire`/`mastersMotivation` with legacy fallback.

### Documented but NOT changed in this release (see RELEASE_BLOCKERS.md / known gaps)

- **Auth is intentionally bypassed** (`requireConsultantSession` returns a dummy ADMIN). All authorization checks are structural (ownership/UUID validation). Enabling login is a separate phase; `/api/metrics` is already independently protected.
- `POST /api/benchmark/run` accepts a raw file path (internal test harness) — not a canonical workflow endpoint.
- `POST /api/requirements/save` is publicly callable under the bypassed auth — same trust model as the rest of the app today.
- `POST /api/auth/login` documents a rate limit that isn't implemented — irrelevant while login is disabled.
- `VISA_SOP`/`LOR` have evidence requirements that intake partially covers; `LOR` has no recommender-intake section (data-model gap, not a UI bug).
- `/applications` and `/requirements-library` are live but not linked in the header — orphaned, by current design.
- Faculty-alignment panel is dead code for a single MIT test application — not canonical.
- `ProfileContext` autosave and intake PUT don't use `expectedRevision` optimistic concurrency — documented limitation.

## Responsive verification (real rendering via Puppeteer on production)

Measured at **1440 / 938 / 768 / 390 px** on `/students`, `/students/new`, `/applications`, student workspace, application workspace, intake (sections 1 & 9), document workspace:

- **Horizontal overflow: none** on any page at any width.
- No clipped controls; `IntakeTracker` intentionally switches to a horizontal-scroll strip below `lg`; the document workspace grid collapses to single column below `lg`.
- The only `text-dvivid-error` elements rendered are required-field asterisks and the "Remove" buttons (verified — not error states).

## "What do I do next?" — verified

| Page | Primary next action | Obvious in ~3s? |
|------|--------------------|-----------------|
| /students | "+ New Applicant" | Yes |
| /students/new | "Create Applicant & Application →" | Yes |
| /students/[id] | "+ New Application" | Yes |
| Application workspace | State-based CTA (one primary) | Yes — now includes GENERATING/FAILED |
| Intake section | "Save & Continue →" / "Save & Finish →" | Yes + "Exit to application" |
| Document workspace | Readiness panel → Generate → Save → Approve → Export | Yes — blockers shown *before* the button |

## Async/double-submit states

All canonical actions disable their button while busy (generate, save version, approve, export, resolve, discovery, create, CV upload/apply). Save-status indicator reflects actual state. No double-submit paths found in the canonical flow.
