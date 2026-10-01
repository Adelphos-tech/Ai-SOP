# GENERATION STATE TRANSITIONS — authoritative table

Canonical definitions live in `src/lib/application/generation-lifecycle.ts`:

- `ACTIVE_GENERATION_STATUSES` = QUEUED, RUNNING, RECOVERING, CANCEL_REQUESTED
- `CANCELLABLE_RUN_STATUSES`  = QUEUED, RUNNING, RECOVERING
- `TERMINAL_RUN_STATUSES`     = COMPLETED, FAILED, CANCELLED

All SQL IN-lists derive from `runStatusInSql(...)` — no literal status
lists exist outside this module (`generation-state-ownership.test.ts`
asserts delete-path coverage end-to-end).

No SUPERSEDED status was added: supersession is expressed as
`FAILED` + `failure_message = 'SUPERSEDED_BY_NEWER_RUN'` — terminal, so
recovery can never resurrect it and cleanup treats it uniformly.

## Transition table

| From | To | Mechanism | Owner required? | Provider cancel? | Doc lock retained? | Terminal? |
|---|---|---|---|---|---|---|
| — | QUEUED | createGenerationRun (row insert; legacy — runs currently start RUNNING) | n/a | no | n/a | no |
| — | RUNNING | createGenerationRun | lock CAS must have been acquired first | no | yes (by this run) | no |
| QUEUED/RUNNING (stale-hb) /RECOVERING | RUNNING | claimRunForResume CAS — exactly one claimer wins | resume must also adoptRunOwnership | no | yes | no |
| RUNNING | RECOVERING | markRunRecovering CAS (`recovery_count < 3`) | owner | NO — response kept alive for resume | yes | no |
| QUEUED/RUNNING/RECOVERING | CANCEL_REQUESTED | requestCancelGeneration CAS (latest active run) | targets latest active | best-effort at route | yes | no |
| any active | CANCELLED | cancelRun CAS | owner-guarded lock release after | yes (provider cancel attempted) | released (owner-guarded) | YES |
| any active | COMPLETED | completeRun CAS + JOIN doc owner check | YES — rejected if `active_generation_run_id` differs | n/a | released (GENERATED) | YES |
| any non-terminal | FAILED | failRun CAS `status NOT IN (terminal)` | owner-guarded doc release | best-effort on supersede | released (FAILED) | YES |
| RUNNING/RECOVERING superseded | FAILED (`SUPERSEDED_BY_NEWER_RUN`) | supersedeRun → failRun | n/a | yes, best-effort on in-flight response | NOT touched (newer run owns) | YES |

## Invariants enforced (DB-level, tested)

1. Terminal states never transition back — all CAS writes filter on
   `status IN (active)` or `NOT IN (terminal)`.
2. `active_generation_run_id` on `application_documents` names the
   authoritative run. Set atomically by `acquireGenerationLock`;
   adopted by `adoptRunOwnership` only when no newer run exists.

   SUPERSESSION RULE (deterministic): a run is superseded when any run
   for the same document has a HIGHER `attempt_seq` — a BIGINT
   AUTO_INCREMENT UNIQUE column assigned at INSERT. Strict total order:
   for any two distinct runs exactly one direction is newer; no ties,
   never UUID lexical order. `created_at` remains for display/logging
   only. Newer rows are only ever created by an explicit generation
   attempt (recovery/stage-retry/polling reuse the same row), so ANY
   newer run supersedes:
     - newer COMPLETED → supersedes (result already produced)
     - newer FAILED    → supersedes (the newer attempt was explicit;
       resurrection of the old one would misattribute failure)
     - newer CANCELLED → supersedes (user deliberately stopped the
       newer attempt; reviving the older paid work is wrong)
   Enforced atomically in claimRunForResume (anti-join CAS),
   adoptRunOwnership (NOT EXISTS), completeRun (anti-join CAS),
   isRunDocumentOwner (latest-run check), releaseDocumentGeneration
   (NOT EXISTS), and createDocumentVersion (in-tx FOR UPDATE guard).
3. A superseded run cannot: claim, adopt ownership, completeRun,
   release the lock, create a version, or write document state —
   verified by CAS affected-rows and owner-guarded UPDATEs.
4. `claimRunForResume` serializes concurrent recovery: one winner via
   status flip; a RUNNING run is claimable only past the stale window.
5. A CANCEL_REQUESTED/CANCELLED run can never be claimed for resume.
6. Delete paths (document/application/student) reject when ANY active
   run exists — canonical list, single source.
7. Stage boundaries (`throwIfCancelled`) check ownership — a superseded
   run aborts before any further provider call.
8. DELETE vs GENERATION-START TOCTOU: both operations contend on the
   same `application_documents` row. Delete holds `SELECT ... FOR UPDATE`
   on the parent row AND every contained document row; lock acquisition
   is an atomic UPDATE on the same row — InnoDB serializes the two.
   Generation-start first → delete reads committed GENERATING and
   rejects. Delete first → the lock UPDATE blocks until commit then
   affects 0 rows → generation fails before any provider call.
   Proven on real concurrent connections in
   `generation-ownership-races.test.ts` (sections 3–5).
