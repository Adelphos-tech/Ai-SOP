# Library Adoption Audit — Custom Code vs Mature Libraries

Date: 2026-09-19 · Read-only · No installs · No migrations · No test runs

## 1. Current stack

`package.json` — 14 production dependencies:

| Installed | Purpose |
|---|---|
| next 14.2.5, react 18.3.1 | framework |
| @tiptap/{react,pm,starter-kit} 2.27.3 | rich editor (live since `09e7442`) |
| mysql2 3.24.4 | DB |
| openai 7.10.0 | provider SDK |
| pdf-lib, pdf-parse, docx, mammoth | document render/parse |
| puppeteer 25.10.0 | PDF render engine |
| motion 13.4.0 | animation |

**Not installed:** zod, ajv, react-hook-form, @tanstack/react-query, swr, xstate, p-retry, p-limit, bottleneck, p-queue, pino, winston, date-fns, dayjs, luxon, nanoid, uuid, zustand, redux, jotai, axios, radix/shadcn/headless-ui.

## 2. Custom infrastructure map

| Area | File(s) | ~LOC | Style |
|---|---|---|---|
| Runtime validation | `model-output-types.ts` + `parseStage` + `generation-contract.ts` | ~400 | hand-rolled `isString/isArray/enum` checks, two layers |
| Form state | 15 files w/ `useState`, 13 w/ manual `onChange` setters | spread | bespoke per-page; no form lib |
| Server-state/cache | 21+ `fetch()` call sites across the 3 main pages; `cache:"no-store"` everywhere; manual `loadAll()` refetch | spread | raw fetch + useEffect + local state |
| Generation lifecycle | `generation-lifecycle.ts` (459) + `generation-service.ts` (486) + `generation-recovery.ts` (83) | ~1,030 | CAS SQL transitions — domain-specific |
| Retry/backoff | `openai-transport.ts` (578) — bounded retries, terminal-failure circuit, no-retry rules | ~150 of it | custom with domain rules |
| Concurrency | `concurrency/resource-limiter.ts` | 217 | custom semaphore + bounded queue + metrics + env config |
| Logging | `JSON.stringify({event,…})` pattern across ~10 files | spread | consistent structured one-liners |
| Rich editor | `DocumentRichEditor.tsx` (Tiptap) | ~120 | library-based ✓ — old textarea removed |
| UI primitives | custom confirm dialog + `UniversitySelect` (role=listbox) | ~80 | bespoke, minimal |
| ID generation | `crypto.randomUUID()` — native, consistent | — | no dep needed |
| Date/time | `Date.now()`/ISO timestamps in ~41 files | small | native, mostly elapsed/duration math |

## 3. Findings by category

### Validation / schema (HIGH PRIORITY)

- **3 parallel shape definitions per AI stage**: TypeScript type + `parseStage` checks + `validate*Output` — the `factReviewer` totals + `blockingReason` production failures were exactly this drift.
- ~35 manual validation predicates in `model-output-types.ts` alone; parseStage adds another ~10.
- **Zod would collapse prompt↔type↔validator drift into one schema** — `z.infer` gives the TS type, `.safeParse` gives the runtime check, and optional fields are declared once. This is the single highest-value adoption.
- Migration surface: MEDIUM — schemas exist as types already; the work is translating ~6 stage contracts + replacing `isString` predicates. Safety semantics (enum strictness, fail-closed rules) are preserved 1:1.

### Server-state / cache (HIGH PRIORITY)

- The readiness-desync + missing-field loop bugs both traced to **hand-rolled fetch/state sync**: `useEffect` load, `loadAll()` refetch, `cache:"no-store"`, manual dirty flags.
- **TanStack Query would replace**: manual loading/error state, refetch-after-mutation, polling (`generation-status` setInterval loop in `GenerationProgressCard`), deduplication.
- Migration surface: MEDIUM — the 3 big pages + generation-status polling + CVUpload + profile mutations. Not every fetch needs it; target the ones with mutation→refetch semantics.
- This is the second-highest-value adoption — it directly prevents the class of bugs we just fixed twice.

### Generation lifecycle

- CAS SQL transitions (`UPDATE … WHERE status IN ('QUEUED','RUNNING')`) — correct, atomic, domain-specific.
- **XState: KEEP CUSTOM.** The lifecycle is DB-backed (multi-process, restart-recovery); a client-side state machine can't express CAS. The current model is already a state machine — just persisted. Migration risk >> benefit.

### Retry / backoff

- `openai-transport.ts` — bounded retries with domain rules: no retry on `max_output_tokens`, no retry on invalid request, terminal-failure circuit, cost accounting, cancellation.
- **p-retry: KEEP CUSTOM.** The rules are D-Vivid-specific; a generic retry lib would need adapters for each rule anyway. Code is already readable and tested.

### Concurrency / queue

- `resource-limiter.ts` — semaphore + bounded queue + rejection + metrics + env config.
- **p-limit/Bottleneck: KEEP CUSTOM.** Domain requirement: *reject* when full (429 semantics), not just queue. Also exposes metrics. 217 LOC, working.

### Forms / intake

- All forms are `useState` + manual `onChange` + manual dirty/error flags. The intake wizard, missing-wizard, student/application creation, document creation — ~6 form surfaces.
- **React Hook Form + Zod: OPTIONAL MIGRATION (P2).** Would reduce per-form boilerplate and unify validation with the schema layer. But the current forms work; the desync bugs were in *server-state sync*, not form logic. Worth doing after Zod lands (shared schemas).
- Migration surface: MEDIUM — touches every intake section component.

### Logging

- `JSON.stringify({event,…})` one-liners — already structured, consistent fields (`event`, `requestId`, `generationId`, `durationMs`).
- **Pino: OPTIONAL (P3).** Would add levels + redaction + faster serialization, but current logs are parseable and grep-friendly. Low value vs effort.

### Error model

- ~8 custom error classes (`StageExecutionError`, `ProviderTerminalError`, `ResourceBusyError`, `AuthError`, `BoundedFinalizerBlockedError`…) with `code` fields.
- **KEEP CUSTOM** — discriminated error classes + codes are already the right pattern. No library needed.

### Rich editor

- Tiptap installed + live; old textarea removed. **Standardize — DO NOT TOUCH.**

### Date/time

- `Date.now()`, ISO strings, `TIMESTAMPDIFF` in SQL — simple, correct.
- **date-fns: DO NOT ADD** — no formatting-heavy code exists; native is sufficient.

### ID generation

- `crypto.randomUUID()` — native, consistent. **No dep.**

### UI primitives

- One custom confirm dialog + `UniversitySelect` (role=listbox, keyboard nav). Minimal surface.
- **Radix: DO NOT MIGRATE** — only 2 bespoke primitives; not worth a new dependency tree.

## 4. Priority matrix

| Area | Current | Recommended | Bug-reduction | Code-reduction | Migration risk | Priority |
|---|---|---|---|---|---|---|
| Stage validation | hand-rolled ×2 layers | **Zod** | HIGH | MEDIUM | Medium | **P0** |
| Server-state sync | fetch+useEffect+no-store | **TanStack Query** | HIGH | MEDIUM | Medium | **P0** |
| Rich editor | Tiptap ✓ | (done) | — | — | — | DONE |
| Form state | useState everywhere | React Hook Form + Zod | MEDIUM | MEDIUM | Medium | P2 |
| Structured logging | JSON.stringify events | Pino | LOW | LOW | Low | P3 |
| Generation lifecycle | CAS state machine | — | — | — | High | **DO NOT MIGRATE** |
| Retry/backoff | domain-tuned custom | — | — | — | High | **DO NOT MIGRATE** |
| Concurrency limiter | custom semaphore+queue | — | — | — | Medium | **DO NOT MIGRATE** |
| Error model | typed error classes | — | — | — | — | **KEEP CUSTOM** |
| Date/time | native | — | — | — | — | **DO NOT ADD** |
| ID gen | crypto.randomUUID | — | — | — | — | **DO NOT ADD** |
| UI primitives | 2 bespoke components | — | — | — | — | **DO NOT MIGRATE** |

## 5. Staged recommendation

**Phase A (highest confidence):**
1. **Zod** — unify prompt/type/validator drift at the contract layer; prevents the next `invalid fact review` class of failure
2. **TanStack Query** — kill the fetch/refetch/no-store desync pattern; target profile/readiness/document/generation-status first
3. Standardize Tiptap — already done

**Phase B:**
4. React Hook Form (+ Zod resolvers) — after Zod lands, forms share the schemas

**Leave alone:**
XState · retry · concurrency · error classes · dates · IDs · UI primitives · all domain logic

## 6. Must remain D-Vivid code (explicit)

- Application readiness rules / intake section semantics
- Prompt precedence + safety blocks
- Generation contract semantics (componentIds, claim provenance, evidence allowlists)
- Six-stage orchestration + checkpoint/resume
- Fact safety + `deriveFactReviewTotals` + `computeSubmissionStatus`
- Document requirement resolution + word-range policy
- Finalizer action planning + FREEZE/COMPRESS rules
- Version approval/override policy
- `resource-limiter` admission rules
- `openai-transport` retry policy (no-retry on max_tokens/invalid)

## 7. Estimated custom-infra footprint

| Area | ~LOC |
|---|---|
| Validation/type guards | ~400 |
| Forms | ~1,800 (spread across pages) |
| Server-state/caching | ~600 (fetch+loadAll+refresh patterns) |
| Retry/concurrency | ~800 (transport + limiter + recovery) |
| Editor | ~120 (library-based) |
| Logging | ~80 (inline, consistent) |
| **Total custom infra** | **~3,800** of 24,848 src LOC (~15%) |

## 8. Bottom line

- **Biggest current custom-code risk:** hand-rolled AI-output validation drift (already cost 2 paid failed runs) → Zod
- **Biggest low-risk win:** TanStack Query on the profile/readiness/document surfaces — directly prevents the desync class we fixed twice
- **Biggest migration to avoid:** generation lifecycle → XState (DB-CAS semantics can't be replaced by a client-side machine)

**No installs. No migrations. No test runs. Audit only.**
