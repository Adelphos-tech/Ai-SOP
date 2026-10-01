# REMEDIATION WAVE 1 — GENERATION STATE OWNERSHIP

Fixed GEN-003 (delete-during-RECOVERING) at the root and GEN-004
(run supersession) with a deterministic ownership mechanism, verified
by real-DB CAS tests. No paid OpenAI calls. No production mutations.

## What changed

### Canonical status domain (`generation-lifecycle.ts`)
- `ACTIVE_GENERATION_STATUSES` is the single source of truth
  (QUEUED/RUNNING/RECOVERING/CANCEL_REQUESTED); `ACTIVE_RUN_STATUSES`
  kept as alias.
- `CANCELLABLE_RUN_STATUSES`, `RESUME_CLAIMABLE_RUN_STATUSES`,
  `TERMINAL_RUN_STATUSES`, `isActiveGenerationStatus`,
  `isTerminalRunStatus`, `runStatusInSql()` — every SQL IN-list now
  derives from these. Zero hand-maintained status lists remain.
- `claimRunForResume(runId)` — CAS claim: QUEUED/RECOVERING flip to
  RUNNING (serializes claimants); RUNNING claimable only past the
  stale-heartbeat window; CANCEL_REQUESTED/terminal never claimable.
- `GenerationSupersededError` — thrown at pipeline stage boundaries.
- `completeRun` — now a JOIN-guarded CAS: rejected unless
  `application_documents.active_generation_run_id` names this run
  (or is NULL legacy).
- Schema ensure also covers `provider_error_message` (was missing —
  silently broke terminal-failure persistence, found via test).

### Ownership column (`application-repository.ts`, `schema.ts`)
- `application_documents.active_generation_run_id VARCHAR(36)` —
  added to schema DDL + idempotent runtime ALTER.
- `acquireGenerationLock(documentId, runId)` — lock + ownership in ONE
  conditional UPDATE.
- `adoptRunOwnership(documentId, runId)` — CAS: succeeds only if doc
  GENERATING, ownership free-or-self, and no newer active run exists.
- `isRunDocumentOwner(documentId, runId)` — owner column or
  latest-active-run fallback for NULL legacy rows.
- `releaseDocumentGeneration(documentId, runId, status)` — owner-guarded
  release + ownership clear; `null` runId = verified no-run stale path.
- `releaseOrphanedDocumentLock(documentId)` — catch-all release fires
  only when NO active run exists.

### Delete safety (GEN-003 root fix)
- `deleteDocumentCascade` — canonical IN-list, covers RECOVERING.
- `deleteApplicationCascade` / `deleteStudentCascade` — NEW active-run
  guards; now return `"DELETED"|"NOT_FOUND"|"GENERATING"`; routes map
  GENERATING → 409 `GENERATION_IN_PROGRESS`.

### Supersession (GEN-004 fix)
- Resume entry: `claimResumeOwnership` = getRun → active-status check →
  `claimRunForResume` CAS → `adoptRunOwnership` CAS. Failure →
  `supersedeRun`: run marked FAILED (`SUPERSEDED_BY_NEWER_RUN`),
  in-flight provider response cancelled best-effort, document untouched.
- Pipeline `throwIfCancelled` → also checks `isRunDocumentOwner` at
  every stage boundary → `GenerationSupersededError` → pipeline returns
  `RUN_SUPERSEDED` → service supersede path. No further provider calls.
- Service success path re-checks ownership before `createDocumentVersion`
  and relies on `completeRun`'s owner-guarded CAS; cancel/fail paths use
  owner-guarded `releaseDocumentGeneration`.

## Verification

- `tests/generation-state-ownership.test.ts` — 61 real-DB assertions
  covering race matrix A–J, cascade guards, claim/adopt/release CAS
  semantics. All pass.
- `tests/generation-lifecycle-tests.ts` — updated to new lock API;
  38 pass.
- `tests/background-transport-tests.ts` — 68 pass (was 61/7 — the
  missing `provider_error_message` column fix repaired them).
- `tests/document-delete-workflow.test.ts` — updated D-check to assert
  canonical-list usage; 10 pass.
- Full deterministic suite green; typecheck clean; build passes.
- `GENERATION_STATE_TRANSITIONS.md` — authoritative transition table.

## FINAL RACE PROOF (follow-up wave)

Two remaining ownership races audited and closed:

### Race 1 — older RECOVERING run vs newer TERMINAL run

Before: supersession checks only rejected a newer **active** run. An
older RECOVERING run could claim + adopt after the newer run reached a
terminal state in a narrow window (stale GENERATING lock + NULL owner).

Fix: the supersession rule is now status-agnostic — ANY other run for
the same document with `created_at >=` this run's supersedes it
(deterministic DB ordering; same-ms ties fail closed). Enforced
atomically via LEFT JOIN anti-join / NOT EXISTS inside:

- `claimRunForResume` — claim CAS rejects when a newer row exists.
- `adoptRunOwnership` — NOT EXISTS covers all statuses.
- `completeRun` — anti-join added alongside the owner JOIN.
- `isRunDocumentOwner` — NULL-owner fallback = latest run (any status).
- `releaseDocumentGeneration` — NEW guard: a stale run's release can no
  longer clobber a document released by a newer terminal run.
- `createDocumentVersion` — NEW `expectedGenerationRunId` param: the
  FOR UPDATE row read re-verifies ownership inside the version
  transaction (TOCTOU-proof); `GenerationSupersededError` on loss.
  Consultant-save path (no run id) unaffected.
- Service: `claimResumeOwnership` distinguishes claim-failure causes via
  `hasNewerGenerationRun` → `superseded` → `supersedeRun` (FAILED +
  `SUPERSEDED_BY_NEWER_RUN`, best-effort provider cancel, doc untouched).

### Race 2 — delete vs generation-start TOCTOU

Both sides now contend on the SAME `application_documents` rows:

- `deleteDocumentCascade` already held the doc row `FOR UPDATE` for the
  whole transaction — safe.
- `deleteApplicationCascade` — NEW: `SELECT ... FOR UPDATE` on every
  contained document row + reject if any `generation_status =
  'GENERATING'`, before the active-run check and deletes.
- `deleteStudentCascade` — NEW: same doc-row locking via join.
- `acquireGenerationLock` is a single-row UPDATE on the doc — it either
  blocks on the delete's row locks (then sees the deleted row → 0
  affected → no run, no provider call) or commits GENERATING first
  (→ delete's FOR UPDATE read sees the flag → rejects).
- FK discipline: concurrent `INSERT INTO application_documents` takes a
  shared lock on the parent `applications` row — blocked while the
  cascade holds it, fails on missing parent after commit.

### DB-level race tests — `tests/generation-ownership-races.test.ts`

46 assertions, real concurrent connections (not sequential mocks):

1. RECOVERING A + newer COMPLETED B → claim/adopt/complete/release all
   rejected; B's GENERATED state untouched.
2. Newer FAILED B + owner released → A cannot reclaim.
2b. Newer CANCELLED B → A cannot reclaim.
3. Concurrent doc delete + lock acquire — BOTH orderings proven
   (blocked-then-failed / acquire-then-delete-rejected).
4. Concurrent application delete + contained lock acquire — same.
5. Concurrent student delete + contained lock acquire — same.
6. completeRun from stale owner → 0 affected (owner-set and NULL-owner
   variants).
7. createDocumentVersion from stale owner → GenerationSupersededError
   (owner-set and NULL-owner variants); legit owner + consultant paths
   unaffected.
8. Duplicate recovery after newer terminal run → both claims rejected.

### Production rollout — `active_generation_run_id`

Idempotent schema ensure, NOT a timed migration:
`ensureGenerationLifecycleSchema()` runs an `ALTER TABLE
application_documents ADD COLUMN active_generation_run_id` tolerant of
`ER_DUP_FIELDNAME`, invoked at the TOP of every function that reads or
writes the column (acquireGenerationLock, isRunDocumentOwner,
adoptRunOwnership, releaseDocumentGeneration, releaseOrphanedDocumentLock,
createDocumentVersion) and inside `ensureGenerationRunsTable` (used by
claimRunForResume / completeRun). No code path reads the column before
the ensure has run. Fresh installs get it from `schema.ts` CREATE TABLE.
Existing in-flight runs keep NULL owner → latest-run fallback.

## STRICT TOTAL ORDERING (attempt_seq)

The ordering audit showed `created_at` ties break antisymmetry (both
runs see each other as newer) and make `isRunDocumentOwner`
nondeterministic. Fixed with `generation_runs.attempt_seq BIGINT NOT
NULL AUTO_INCREMENT UNIQUE` — DB-assigned at INSERT, strictly
increasing, immutable.

- Primary rollout: `migrations/2026-10-01-active-generation-run-id.sql`
  + `migrations/2026-10-01-generation-runs-attempt-seq.sql`
  (three-step: add column → deterministic backfill `created_at ASC,
  id ASC` → MODIFY AUTO_INCREMENT UNIQUE). Runtime ensure retained as
  dev/test safety net only, guarded by an information_schema check so
  repeated ensures never duplicate the UNIQUE index.
- Historical tie-breaker policy: `id ASC` — migration-only convention;
  true sub-ms ordering is unrecoverable, safe because all historical
  runs are terminal.
- Every authority comparison converted from `created_at` to
  `attempt_seq`: claimRunForResume, adoptRunOwnership,
  hasNewerGenerationRun, isRunDocumentOwner, completeRun,
  releaseDocumentGeneration, createDocumentVersion ownership guard,
  requestCancelGeneration latest-run targeting, getLatestRun,
  getActiveRuns ordering.
- `created_at` survives only in: UI listing order, provider-response
  reuse ordering (different table), the backfill itself.
- Migration safety: pre-check `COUNT(*) WHERE status IN (active)` —
  migration is NOT safe while truly-active runs exist (a NULL-seq row
  created mid-window would defeat anti-join checks); local DB showed 70
  stale-heartbeat RUNNING dev rows — gate on prod before applying.
- MySQL 9.6 verified: column add is INSTANT; UNIQUE index build is
  INPLACE (not INSTANT) — brief MDL possible.
- Tested: `tests/generation-run-ordering.test.ts` — 39 assertions
  (same-ts distinct seqs, antisymmetry/totality, terminal newer run
  supersession ×3, 3-run transitivity, 6-way concurrent insert
  uniqueness, stale-run version/complete rejection, table-wide
  non-null uniqueness).

## PRODUCTION ROLLOUT REMEDIATION — migration-owned schema

The runtime ensure could previously execute the full attempt_seq
migration (ADD + backfill + MODIFY+UNIQUE) and the
active_generation_run_id ALTER from request traffic — rollout blocker.

Now split:

- `src/lib/application/generation-schema.ts` owns both sides:
  - `assertGenerationLifecycleSchema()` — memoized, read-only
    information_schema verification; throws `SchemaMigrationRequiredError`
    (SCHEMA_MIGRATION_REQUIRED) listing missing elements. All lifecycle
    functions and repository ownership paths call this first.
  - `runGenerationOrderingMigrations()` — explicit deployment command
    path only (scripts + test bootstrap). Refuses with
    `GENERATION_MIGRATION_BLOCKED_ACTIVE_RUNS` when active runs exist
    (gate runs before ANY DDL; `allowActiveRuns` is test-only).
  - `precheckGenerationMigration()` — read-only aggregate counts.
- `generation-lifecycle.ensureGenerationRunsTable` now delegates to the
  assertion; `ensureGenerationLifecycleSchema` is a back-compat alias
  for the same assertion.
- Friendly 503 mapping (no SQL leaked): generation-service entry,
  generation cancel route, generation-status route return
  `SCHEMA_MIGRATION_REQUIRED` + "Generation is temporarily unavailable
  because the application database requires an update."
- Commands:
    npm run generation:migration-precheck   (read-only, exit 0/2)
    npm run migrate:generation-ordering     (explicit migration, gated)
- Legacy additive columns decision (spec §11): recovery_count,
  warnings_json, provider_error_message → MOVED TO MIGRATIONS (runner
  applies them idempotently; runtime assertion verifies). No column
  self-migrates at runtime anymore.
- Deployment procedure documented in the migration SQL files:
  quiesce generation starts → drain/reconcile → precheck=0 → migrate →
  verify → deploy code → re-enable.
- Rollback: old code + new columns = compatible (additive only);
  new code + missing schema = fail-fast SCHEMA_MIGRATION_REQUIRED,
  never auto-repair.
- Local sop_ai_app: 70 ORPHANED RUNNING rows (docs deleted) — NOT
  cleaned in this task; migration correctly refused (exit 2) until
  operator reconciles them.
