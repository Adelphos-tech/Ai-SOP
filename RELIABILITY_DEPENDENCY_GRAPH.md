# RELIABILITY DEPENDENCY GRAPH

Root causes → downstream symptoms. Fix order matters: downstream issues
often resolve or clarify once roots are fixed.

## Graph

```
PROVIDER RESPONSE LIFECYCLE (was: cancel-at-SLA — FIXED)
├── timeout recovery (RECOVERING)          [done]
├── retry accounting semantics             [verified clean]
├── user retry UX                          [done — normalized errors]
└── GEN-004 supersede-check                [OPEN — depends on lifecycle]

STATUS ENUMERATION
├── ACTIVE_RUN_STATUSES (lifecycle)        [correct]
└── deleteDocumentCascade literal list     [OPEN — GEN-003]
         │
         └── every future status must update BOTH sites
             → root: duplicated enumeration (DB-002 amplifies)

RESUME PARSER STRATEGY QUALITY
├── coverage classification (CV-004 ranking)     [depends: strategy output shape]
├── review UX (what consultant sees)             [depends: classification]
└── apply/merge correctness (CV-006 provenance)  [depends: mapping granularity]
         │
         └── root: mapper section-header dependency (CV-001)
             └── mitigation order (mammoth-first) works AROUND, not fixes

APPLICATION-SCOPED DATA IN STUDENT PROFILE (DB-001)
├── evidence bundle correctness for 2nd app  [downstream]
├── consultant overwrite confusion           [downstream]
└── provenance trust                         [downstream]
         │
         └── root: schema scope — architectural change deferred

OBSERVABILITY (OBS-001/OPS-001)
├── planner failure undiagnosable            [downstream]
├── cost auditability                        [partially downstream]
└── root: usage-ledger schema predates error taxonomy

TEST REALITY-GAP (TEST-001/003)
├── CAS transition untested at DB level      [downstream]
├── RECOVERING paths code-review-only        [downstream]
└── root: no DB test harness — not a test-content problem

DEAD TREE (REQ-002)
└── deploy/src divergence                    [downstream confusion only]
```

## ROOT CAUSE vs SYMPTOM table

| SYMPTOM | ROOT CAUSE | SECONDARY CONTRIBUTORS | FIXING SYMPTOM ONLY WOULD... | ROOT-LEVEL SOLUTION CLASS |
|---|---|---|---|---|
| STAGE_TIMEOUT:factReviewer, paid work lost | cancel-at-SLA policy destroyed resumable response | reasoning-effort latency, prompt verbosity (unproven) | leave next timeout equally destructive; retry = repay | KEEP + FIX policy (DONE) |
| Khushi CV empty (Docling path) | mapper requires section_header blocks Docling never emits for table-layout docs | large-file sidecar fragility (CV-003) | each new heading regex catches one doc class; next layout fails | strategy architecture (done) + mapper section-inference |
| edu=21 phantom entries win ranking | coverageRank rewards volume; no plausibility signal | legacy parser's over-segmentation | capping count at 5 hides a different over-parse | deterministic plausibility/dedup in ranking |
| CV skills from replaced CV persist | skills merge has no per-item provenance | apply merge granularity | manual cleanup each time | extend cv-* id model to skills or snapshot-diff revert |
| run RECOVERING, doc deletable | status enumeration duplicated outside ACTIVE_RUN_STATUSES | no FK cascade (DB-002) | add RECOVERING to this list; next new status repeats the bug | single source of truth for active statuses + FK |
| two pipelines on one document | resume path skips lock; no supersede check | lock expiry on wall-clock | hardening one path leaves the other | supersede-check in resumeRun + lock-aware resume |
| failed-run warnings lost | warnings_json only written at complete | — | cosmetic now; audit trail incomplete | persist warnings on failRun |
| planner failures undiagnosable | usage ledger has no error field | 7/22 local failure rate | more log reading, same blindness | add errorCode to ledger schema |
| GET status can launch paid resume | no background worker; GET doubles as scheduler | — | moving to POST still lacks an owner process | dedicated resume owner (worker/cron) pre-prod |
| app-scoped intake overwrites across applications | fields stored in students.profile_data | — | field-level warnings hide the data-loss pattern | application-scoped storage (architectural, deferred) |

## Priority classification

### P0 — data corruption / unsafe output / paid-work loss with no recovery
- **GEN-003** delete during RECOVERING → orphaned paid work + lost checkpoints

### P1 — core valid workflow frequently blocked or silently wrong
- **GEN-004** double-pipeline via stale RECOVERING + expired lock
- **CV-004** over-parse wins ranking (wrong candidate shown to consultant)
- **CV-006** skills provenance gap (wrong-person CV residue)
- **CV-007** unconditional profile overwrite fallback
- **DB-001** app-scoped data at student scope (contamination across apps)
- **OBS-001** failure rows without error classification (undiagnosable prod failures)

### P2 — recoverable degraded experience
- **GEN-005** maxDuration vs recovery-window mismatch (UX confusion)
- **GEN-006** GET-with-side-effects (fragile scheduler)
- **GEN-008** prompt-version blunt invalidation (cost)
- **GEN-009** failed-run warnings dropped
- **CV-003** timeout without abort (resource leak)
- **OPS-001** unbounded log growth
- **TEST-001** no DB-level CAS tests
- **TEST-003** mock-latency realism gap

### P3 — maintainability / cleanup
- **REQ-002** dead deploy/ tree
- **TEST-002** gitignored fixture fragility
- **CV-008** exact-match dedup only
- **GEN-010** single-instance assumption (document only)
- **GEN-012** cosmetic stage-label timing
- **RENDER-001** fresh-Chromium-per-render (scale risk)
- **AUTH-001** intentional bypass (pre-prod checklist item)

## Recommended remediation order (dependency-aware)

1. **GEN-003** — add RECOVERING to delete guard; extract active-status list
   to shared constant (prevents recurrence of the same class).
2. **GEN-004** — supersede-check in resumeRun (latest-active-run guard).
   Depends on understanding from #1's status semantics.
3. **OBS-001** — add errorCode to usage ledger. Unblocks future root-cause
   work; cheap.
4. **CV-004** — deterministic plausibility/dedup weight in coverageRank.
   Depends on nothing; improves consultant-facing correctness.
5. **CV-006 + CV-007** — provenance extension + require revision. Same
   subsystem; fix together.
6. **GEN-009, GEN-005, GEN-006** — lifecycle polish (warnings persist,
   budget doc, resume owner) — after 1-2 stabilize.
7. **TEST-001** — DB-level transition harness — once statuses stabilize
   post-1/2.
8. **DB-001** — application-scoped intake migration — ARCHITECTURAL;
   schedule separately with data migration plan.
9. **CV-005** — OCR path — feature decision, not remediation.
10. **OPS-001, REQ-002, TEST-002/003, RENDER-001** — hygiene batch.
