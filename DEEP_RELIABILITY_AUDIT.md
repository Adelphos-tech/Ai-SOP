# DEEP RELIABILITY AUDIT — Master Issue Inventory

Audit-only. Zero production changes. Evidence drawn from: source, local MySQL
(`generation_runs`, `generation_stage_responses`, `application_documents`),
`logs/attempts/*` run-state files, `logs/openai-usage.jsonl` (85 entries),
git history, and the prior `PRODUCTION_ERROR_AUDIT.md`.

Convention: CONFIRMED = proven by code/DB/log evidence; PARTIAL = mechanism
identified, trigger conditions incomplete; SUSPECTED = plausible, unproven;
HISTORICAL-FIXED = previously broken, fix verified this wave.

=====================================================================
ISSUE INVENTORY
=====================================================================

----------------------------------------------------------------------
ISSUE ID: GEN-001
TITLE: Stage-SLA cancel destroyed resumable paid provider response
STATUS: HISTORICAL-FIXED
FIRST OBSERVED: STAGE_TIMEOUT:factReviewer production incident (Sept)
LAST OBSERVED: fixed in generation-resilience wave
AFFECTED SUBSYSTEM: openai-transport → waitForBackgroundStage
USER-FACING SYMPTOM: document FAILED after ~5 min despite provider still working
TECHNICAL SYMPTOM: cancelBackgroundStage() fired at slaMs; 1,183 output tokens
  (976 reasoning) produced before cancel; paid work discarded
REPRODUCIBLE: YES (mock transport, tests/generation-resilience.test.ts #3-4)
EXACT REPRODUCTION STEPS: in_progress response + elapsed>slaMs → old code cancelled
EXPECTED BEHAVIOR: keep polling same response; RECOVERING on exhaustion
ACTUAL BEHAVIOR (NOW): SLA → extension window → recoverable timeout, NO cancel
CODE PATH: waitForBackgroundStage elapsed>slaMs branch
FILES: src/lib/ai/openai-transport.ts, src/lib/application/generation-service.ts
FUNCTIONS: waitForBackgroundStage, markRunRecovering
DB TABLES: generation_runs, generation_stage_responses
EXTERNAL DEPENDENCIES: OpenAI Responses API background mode
ROOT CAUSE: local stage SLA conflated with "work failed"; cancel destroyed
  reusable provider state. CONFIRMED (production usage metadata + code).
ROOT CAUSE CONFIDENCE: CONFIRMED
EVIDENCE: run-state.json failure records; prior audit log of response
  resp_00a3396b with 1,183 output tokens at cancellation.
WHY CURRENT TESTS MISSED IT: no test exercised an in-flight-at-SLA response.
DATA LOSS: NO (work product lost, no data corruption)
PAID COST IMPACT: YES (cancelled response still billed, retry re-billed)
USER BLOCKED: YES (historical); now auto-recovers
RECOVERABLE: YES (now)
CURRENT RECOVERY PATH: RECOVERING → stale heartbeat → resume → poll same responseId
ARCHITECTURAL OR LOCAL BUG: LOCAL (policy, not architecture)
CUSTOM CODE INVOLVED: YES
MATURE LIBRARY/SERVICE COULD REPLACE THIS: NO (provider-specific semantics)
PREFERRED SOLUTION CLASS: KEEP + FIX (done)

----------------------------------------------------------------------
ISSUE ID: GEN-002
TITLE: CONTENT_JSON_INVALID / schema-invalid runs were unresumable
STATUS: HISTORICAL-FIXED
FIRST OBSERVED: Gemini experiments + stage-execution FAILED_CONTENT
LAST OBSERVED: fixed this wave
AFFECTED SUBSYSTEM: stage-execution classifyFailure
USER-FACING SYMPTOM: retry after parse failure restarted or refused resume
TECHNICAL SYMPTOM: kind=CONTENT → FAILED_CONTENT → TECHNICAL_RETRY_NOT_ALLOWED
REPRODUCIBLE: YES
EXPECTED: contract deviations are plausibly transient → technical/retryable
ACTUAL (NOW): CONTENT_JSON_INVALID/CONTENT_SCHEMA_INVALID/AI_STAGE_SCHEMA_INVALID
  are technical=true; in-run same-stage retry (bounded) + content_invalid marking
  prevents replaying the bad provider response.
CODE PATH: parseStage → StageExecutionError → execute() catch
FILES: src/lib/ai/pipeline/stage-execution.ts, run-application-pipeline.ts
ROOT CAUSE: format deviation misclassified as content (non-resumable) failure.
ROOT CAUSE CONFIDENCE: CONFIRMED
EVIDENCE: tests/generation-resilience.test.ts #1-2 pass
WHY MISSED: CONTENT vs TECHNICAL taxonomy conflated "model wrote prose" with
  "content policy rejected".
DATA LOSS: NO | PAID COST: YES (unresumable → full re-pay on manual retry)
USER BLOCKED: YES | RECOVERABLE: YES
ARCHITECTURAL OR LOCAL: LOCAL | CUSTOM: YES | LIBRARY: NO
PREFERRED SOLUTION CLASS: KEEP + FIX (done)

----------------------------------------------------------------------
ISSUE ID: GEN-003
TITLE: deleteDocumentCascade misses RECOVERING status — delete during recovery
STATUS: CONFIRMED (new — introduced by RECOVERING status)
FIRST OBSERVED: this audit
LAST OBSERVED: n/a
AFFECTED SUBSYSTEM: application-repository delete path
USER-FACING SYMPTOM: consultant can delete a document whose generation is
  RECOVERING; the in-flight provider response is then orphaned
TECHNICAL SYMPTOM: run-status guard lists ('QUEUED','RUNNING','CANCEL_REQUESTED')
  — RECOVERING absent → row deleted while resume pending
REPRODUCIBLE: YES (code inspection — status list literal at repository.ts:426)
EXPECTED: delete refused while any active run exists
ACTUAL: delete succeeds; orphaned provider response keeps billing; later
  recovery finds no document → resumeRun fails at context load
CODE PATH: DELETE /document/delete → deleteDocumentCascade
FILES: src/lib/application/application-repository.ts (~line 419-431)
FUNCTIONS: deleteDocumentCascade
DB TABLES: application_documents, generation_runs, generation_stage_responses
ROOT CAUSE: RECOVERING added to ACTIVE_RUN_STATUSES but this site enumerates
  its own literal list — not updated. CONFIRMED.
ROOT CAUSE CONFIDENCE: CONFIRMED
EVIDENCE: literal status list at repository.ts:426 vs lifecycle ACTIVE_RUN_STATUSES
WHY TESTS MISSED: no delete-vs-RECOVERING test.
DATA LOSS: YES (document + paid checkpoints deleted under in-flight work)
PAID COST IMPACT: YES (orphaned response billed, result discarded)
USER BLOCKED: NO | RECOVERABLE: NO (post-delete)
CURRENT RECOVERY PATH: none — delete wins silently
ARCHITECTURAL OR LOCAL: LOCAL
PREFERRED SOLUTION CLASS: KEEP + FIX (add RECOVERING to the guard list)

----------------------------------------------------------------------
ISSUE ID: GEN-004
TITLE: Stale RECOVERING run can be double-resumed next to a fresh generation
STATUS: PARTIAL
FIRST OBSERVED: this audit
AFFECTED SUBSYSTEM: lifecycle + recovery
TECHNICAL SYMPTOM: doc lock expires at generation_started_at+10min; a consultant
  may start a NEW run (CONTENT_REGENERATION) while an old RECOVERING run still
  exists; a later status-poll/restart recovers the OLD run → two pipelines on
  one document (different attempt dirs → no file-lock collision).
REPRODUCIBLE: PARTIAL (requires real timing: lock expiry + status poll)
EXPECTED: only the newest active run may resume; superseded runs finalize
ACTUAL: no "superseded run" check — recoverInterruptedGenerations /
  maybeRecoverRun resume ANY active run regardless of newer siblings
CODE PATH: generation-recovery.ts resumeRun → generateApplicationDocument(resumeRunId)
FILES: src/lib/application/generation-recovery.ts, generation-service.ts
DB TABLES: generation_runs, application_documents
ROOT CAUSE: resume path skips the generation lock (resumeRunId → acquired=true)
  and no check that the run is still the document's LATEST active run.
ROOT CAUSE CONFIDENCE: HIGH (code-proven; production trigger rare)
EVIDENCE: acquireGenerationLock skipped when resumeRunId set;
  getActiveRuns returns all RECOVERING rows.
WHY TESTS MISSED: deterministic tests can't cover multi-run DB timing.
DATA LOSS: NO | PAID COST: YES (fingerprint dedup caps it — second pipeline
  reuses completed stage responses; duplicated work is mostly free)
USER BLOCKED: NO | RECOVERABLE: YES (CAS completion; last writer wins version)
CURRENT RECOVERY PATH: file-lock + fingerprint dedup mitigate partially
ARCHITECTURAL OR LOCAL: ARCHITECTURAL
PREFERRED SOLUTION CLASS: KEEP + FIX (supersede-check in resumeRun)

----------------------------------------------------------------------
ISSUE ID: GEN-005
TITLE: maxDuration=300 < stage SLA (300) + recovery window (240)
STATUS: CONFIRMED
AFFECTED SUBSYSTEM: generate route budget vs transport budgets
TECHNICAL SYMPTOM: `export const maxDuration = 300` on the generate route;
  factReviewer can legitimately need 300s SLA + 240s recovery = 540s.
  On Next.js serverless the handler would be killed; on PM2/self-host the
  async work continues but the HTTP response may already be abandoned.
EXPECTED: recovery completion surfaces to the client via status polling
ACTUAL: the request-response may be dropped at 300s; recovery happens
  out-of-band via RECOVERING + status endpoint — by design, but the POST
  caller never sees a response.
CODE PATH: generate/route.ts maxDuration → pipeline → waitForBackgroundStage
ROOT CAUSE: budgets defined in different layers without a shared ceiling
  constant. CONFIRMED by arithmetic.
ROOT CAUSE CONFIDENCE: CONFIRMED
EVIDENCE: maxDuration=300 (route); getStageSlaMs default 300000;
  getStageRecoveryMs default 240000.
WHY MISSED: values added at different times; no single budget audit.
DATA LOSS: NO | PAID COST: NO | USER BLOCKED: PARTIAL (confusing UX —
  POST hangs; poll shows RECOVERING anyway)
RECOVERABLE: YES
ARCHITECTURAL OR LOCAL: MIXED
PREFERRED SOLUTION CLASS: KEEP + FIX (document that POST is fire-and-forget
  for long tails; status endpoint is the authoritative channel)

----------------------------------------------------------------------
ISSUE ID: GEN-006
TITLE: Status GET mutates state — poll can trigger pipeline resume
STATUS: CONFIRMED (design wart)
AFFECTED SUBSYSTEM: generation-status route → maybeRecoverRun
TECHNICAL SYMPTOM: GET request with side effects: any poll of an orphaned
  run launches generateApplicationDocument — a "read" starts paid work.
EXPECTED: reads are idempotent; resumes scheduled by an owner
ACTUAL: resume fires from a GET (also recoverInterruptedGenerations at boot)
ROOT CAUSE: no background worker — endpoint poll is the only scheduler.
ROOT CAUSE CONFIDENCE: CONFIRMED (by design, but fragile)
EVIDENCE: generation-status/route.ts calls maybeRecoverRun(run).
WHY MISSED: workaround pattern accepted during bootstrap.
DATA LOSS: NO | PAID COST: NO (resume itself is dedup'd) | USER BLOCKED: NO
RECOVERABLE: YES
ARCHITECTURAL: YES
PREFERRED SOLUTION CLASS: ARCHITECTURAL CHANGE (future: dedicated worker or
  cron resume); for model-testing scale, KEEP with race guards.

----------------------------------------------------------------------
ISSUE ID: GEN-007
TITLE: usage ledger records failures without error classification
STATUS: CONFIRMED
AFFECTED SUBSYSTEM: logs/openai-usage.jsonl / logUsage
TECHNICAL SYMPTOM: 7 planner entries `success:false` carry no error/code/
  reason fields — production failures are undiagnosable from the ledger.
EVIDENCE: entries at 09-08/09-09 have only {stage,duration,success:false}.
ROOT CAUSE: logUsage schema predates error classification.
CONFIDENCE: CONFIRMED
WHY MISSED: ledger written before error-taxonomy existed.
DATA LOSS: NO | PAID COST: NO | USER BLOCKED: NO | RECOVERABLE: n/a
PREFERRED: KEEP + FIX (add errorCode field to usage rows)

----------------------------------------------------------------------
ISSUE ID: GEN-008
TITLE: Fingerprint reuse invalidated by ANY hash drift — cosmetic prompt
  version bumps re-bill all completed stages
STATUS: CONFIRMED (by design; worth flagging)
TECHNICAL SYMPTOM: fingerprint = contractHash|stage|model|evidenceHash|
  promptHash. promptVersionHash bump (any prompt edit) invalidates every
  stage's reuse for every in-flight/resumable document.
ROOT CAUSE: correctness-first design; no "harmless change" distinction.
CONFIDENCE: CONFIRMED
PAID COST: YES (under churn) | USER BLOCKED: NO | RECOVERABLE: n/a
PREFERRED: KEEP (model-testing phase); document as cost-tradeoff.

----------------------------------------------------------------------
ISSUE ID: GEN-009
TITLE: Warnings collected on failed runs are discarded
STATUS: CONFIRMED (minor)
TECHNICAL SYMPTOM: warnings_json only written by completeRun(); a run that
  fails after accumulating warnings loses them.
CONFIDENCE: CONFIRMED | USER IMPACT: minor
PREFERRED: KEEP + FIX (persist warnings on failRun too)

----------------------------------------------------------------------
ISSUE ID: GEN-010
TITLE: In-process singletons (live registry, circuit breaker, fingerprint
  failures) assume single PM2 instance
STATUS: CONFIRMED (acceptable at model-testing scale)
TECHNICAL: isGenerationLive, circuit breaker, fingerprintFailures are
  in-memory Maps — a second PM2 worker would see disjoint state.
EVIDENCE: generation-registry.ts, openai-transport.ts circuit maps.
  Deploy uses single PM2 app "sop-app" (no instances>1 found).
ROOT CAUSE: process-local design — fine for 1 instance; breaks silently at 2+.
CONFIDENCE: CONFIRMED (behavior) / deployment count PARTIAL
PREFERRED: NO CHANGE now; document single-instance constraint.

----------------------------------------------------------------------
ISSUE ID: GEN-011
TITLE: Contract-error in-run retry bound interacts with resume-limit
STATUS: CONFIRMED (design consistency verified this wave)
TECHNICAL: in-run retry budget = stageCalls < maxTechnicalRetries so the
  resume gate (failedStageCalls > max → reject) stays reachable.
EVIDENCE: stage-execution catch + tests #2. PREFERRED: NO CHANGE

----------------------------------------------------------------------
ISSUE ID: GEN-012
TITLE: markStageStarted before attempt → stage label may outlive attempt
STATUS: PARTIAL (cosmetic)
TECHNICAL: progress row written before execute() returns; a failed stage
  leaves current_stage pointing at the failed stage — correct for resume
  display, but failureMessage normalization is what UI shows.
CONFIDENCE: PARTIAL | impact: none known. PREFERRED: NO CHANGE

----------------------------------------------------------------------
ISSUE ID: CV-001
TITLE: Docling mapper starves on table-layout DOCX (Khushi class)
STATUS: CONFIRMED — mitigated by pipeline ordering
EVIDENCE: benchmark — 112 blocks extracted, 0 semantic sections; mammoth
  strategy produced name+edu5+certs5. DOCX order now MAMMOTH→DOCLING→TEXT.
ROOT CAUSE: Docling block typing emits no section_header blocks for this
  class; the mapper requires them. CONFIRMED.
PREFERRED: KEEP + FIX (ordering, done); ARCHITECTURAL root (mapper design)

----------------------------------------------------------------------
ISSUE ID: CV-002
TITLE: Legacy parser over-segments PDFs (education=21 phantom entries)
STATUS: CONFIRMED — mitigated by ordering (DOCLING first for PDF)
EVIDENCE: benchmark — Shivang/Kunj PDFs → edu 21 via legacy vs docling's 1-3.
REMAINING RISK: legacy stays PDF fallback; an over-parsed PARTIAL could win
  coverageRank within the same tier (count-weighted, no plausibility check).
PREFERRED: KEEP + FIX (add dedup/plausibility weight to coverageRank later)

----------------------------------------------------------------------
ISSUE ID: CV-003
TITLE: withTimeout abandons but does not kill strategy work
STATUS: CONFIRMED
TECHNICAL: Promise.race timeout leaves the strategy running — Docling
  sidecar request continues consuming CPU after the orchestrator moved on.
CODE PATH: resume-import/index.ts withTimeout; docling-client HTTP call
  not aborted (no AbortController).
PAID COST: NO | RESOURCE: CPU/RAM on sidecar | CONFIDENCE: CONFIRMED
PREFERRED: KEEP + FIX (abort signal into strategies)

----------------------------------------------------------------------
ISSUE ID: CV-004
TITLE: coverageRank counts raw items — over-parsing can outrank within tier
STATUS: CONFIRMED
EVIDENCE: coverageRank = tier·1M + sections·10k + Σcounts·100 + personal·10 —
  no plausibility/dedup check. Cross-tier safe; same-tier favors inflation.
ROOT CAUSE: structural-signal-only design (spec: no AI judging).
CONFIDENCE: CONFIRMED | PREFERRED: KEEP + FIX (plausibility heuristics —
  duplicate-tuple dedup, section coherence — stay deterministic)

----------------------------------------------------------------------
ISSUE ID: CV-005
TITLE: Image-only DOCX (Kunj) → FAILED_FILE — no local OCR path
STATUS: CONFIRMED (feature gap, not a bug)
EVIDENCE: document.xml 0 text runs + 6 embedded drawings; all strategies
  correctly hard-fail. FREE OCR options compared in
  FREE_LIBRARY_REPLACEMENT_AUDIT.md (Tesseract recommended when OCR is
  green-lit).
PREFERRED: SERVICE/LIBRARY when prioritized — not a current defect.

----------------------------------------------------------------------
ISSUE ID: CV-006
TITLE: Skills merge has no per-item provenance → replaceCvDerived blind spot
STATUS: CONFIRMED (documented in code comment)
TECHNICAL: cv-* id stripping covers education/experience/projects/
  achievements only; skills arrays merge by value-dedup, not id — a
  wrong-person CV's skills cannot be removed by replaceCvDerived.
CONFIDENCE: CONFIRMED | PREFERRED: KEEP + FIX (prefix skill provenance or
  snapshot-diff revert)

----------------------------------------------------------------------
ISSUE ID: CV-007
TITLE: Profile save without expectedRevision is unconditional
STATUS: CONFIRMED
TECHNICAL: /api/application/profile POST falls back to non-conditional
  saveStudentProfile when expectedRevision absent — concurrent edits lose.
CODE: profile route lines ~120-126.
CONFIDENCE: CONFIRMED | PREFERRED: KEEP + FIX (require revision)

----------------------------------------------------------------------
ISSUE ID: CV-008
TITLE: CV dedup keys are exact lowercase matches — near-dupes survive
STATUS: CONFIRMED (minor)
EVIDENCE: cv-apply dedup on institution+degree / org+role / name equality.
PREFERRED: NO CHANGE (review UI is the control)

----------------------------------------------------------------------
ISSUE ID: REQ-001
TITLE: useLegacyRequirements column/repository/resolver contract — verified
STATUS: CONFIRMED HEALTHY (no issue)
EVIDENCE: column NOT NULL DEFAULT 0; repository maps !!tinyint;
  ResolverDocumentInput requires boolean; resolver respects flag.
PREFERRED: NO CHANGE

----------------------------------------------------------------------
ISSUE ID: REQ-002
TITLE: deploy/ parallel tree — stale src/lib/requirements + tsconfig
STATUS: CONFIRMED dead tree
EVIDENCE: diff shows deploy/src lacks ai-policy-*, discovery-*, etc.;
  deploy/tsconfig.json types:["node"] unresolvable (no node_modules).
  CI + build reference only server-12b.
PREFERRED: SIMPLIFY (delete or archive after owner confirmation)

----------------------------------------------------------------------
ISSUE ID: DB-001
TITLE: Application-scoped intake fields stored at student level
STATUS: CONFIRMED — ARCHITECTURAL
EVIDENCE: intake/[step] page POSTs mastersMotivation, countryQuestionnaire,
  careerGoals, universityRequirements, subjectRequirements, fieldMotivation
  via /api/application/profile → students.profile_data (student-scoped).
RISK: two applications on one student share the same app-specific answers —
  cross-application contamination; last write wins silently.
CONFIDENCE: CONFIRMED
PREFERRED: ARCHITECTURAL CHANGE (later) — application-scoped storage.
  Model-testing: acceptable but must be surfaced in docs.

----------------------------------------------------------------------
ISSUE ID: DB-002
TITLE: generation_runs / generation_stage_responses have no FK to documents
STATUS: CONFIRMED
TECHNICAL: cascades are hand-written SQL (deleteDocumentCascade); manual
  deletes or future code paths can orphan rows. Recovery depends on these
  tables — orphaning silently breaks resume/reuse.
CONFIDENCE: CONFIRMED | PREFERRED: KEEP + FIX (add FK or centralize cascade)

----------------------------------------------------------------------
ISSUE ID: DB-003
TITLE: Pipeline side-effects not transactional with generation_runs
STATUS: PARTIAL
TECHNICAL: createDocumentVersion + completeRun + updateDocumentStatus run
  sequentially in generation-service; a crash between version insert and
  completeRun leaves run RUNNING (recoverable) + a stray version row.
CONFIDENCE: PARTIAL | PREFERRED: KEEP (single-transaction wrap later)

----------------------------------------------------------------------
ISSUE ID: OPS-001
TITLE: No log rotation/retention — logs/ grows unbounded
STATUS: CONFIRMED
EVIDENCE: logs/openai-usage.jsonl append-only; logs/attempts/* accumulate
  forever (checkpoint dirs + raw stage outputs per run).
PREFERRED: KEEP + FIX (retention sweep)

----------------------------------------------------------------------
ISSUE ID: TEST-001
TITLE: No DB-backed test for run-status transitions (RECOVERING, CAS edges)
STATUS: CONFIRMED
EVIDENCE: resilience tests exercise fs checkpoints + transport mocks; the
  generation_runs CAS states are untested without MySQL.
PREFERRED: TESTING ONLY (db-integration tests or a fake pool harness)

----------------------------------------------------------------------
ISSUE ID: TEST-002
TITLE: Gitignored fixture fragility (phase-17 golden, cv-parser fixtures)
STATUS: CONFIRMED (prior wave: phase-17 regenerated fixture lives outside VCS)
PREFERRED: TESTING ONLY (commit fixtures or pin generation script)

----------------------------------------------------------------------
ISSUE ID: TEST-003
TITLE: Mock polling omits real-world provider latency/jitter classes
STATUS: PARTIAL
EVIDENCE: MockResponsesTransport returns scripted statuses; jitter applied
  only via sleep — network partitions/HTTP 5xx stream not simulated.
PREFERRED: TESTING ONLY (extend mock scripts)

----------------------------------------------------------------------
ISSUE ID: AUTH-001
TITLE: All API routes unauthenticated (intentional dev bypass)
STATUS: CONFIRMED — intentional, production risk
EVIDENCE: requireConsultantSession returns dummy ADMIN "system";
  authorizeStudentAccess consequently permits all studentIds.
PREFERRED: NO CHANGE now (explicit project decision); must be on the
  pre-prod checklist.

----------------------------------------------------------------------
ISSUE ID: RENDER-001
TITLE: Fresh Chromium launch per render call
STATUS: CONFIRMED
TECHNICAL: renderer/final-render/pre-final-render each `puppeteer.launch`
  (~200-400MB, ~0.5-1s) per call; 2-4 launches per generation; bounded by
  renderLimiter concurrency cap.
ROOT CAUSE: simplest correct design; no browser pool.
CONFIDENCE: CONFIRMED | impact: latency+RAM spikes under concurrent gens.
PREFERRED: KEEP at model-testing scale; pool browser when throughput matters.

----------------------------------------------------------------------
ISSUE ID: RENDER-002
TITLE: Render failure handling is a warning path — verify never blocks
STATUS: CONFIRMED (safe)
EVIDENCE: render lifecycle wrapped; failures become warnings
  (PAGE_LIMIT_WARNING / RENDER_VALIDATION_REQUIRED), not hard fails.

----------------------------------------------------------------------
ISSUE ID: FILE-001
TITLE: Upload hardening verified — size cap, magic bytes, zip inspection
STATUS: CONFIRMED HEALTHY
EVIDENCE: cv-upload route: Content-Length early reject, 10MB cap,
  %PDF magic, validateDocx (ZIP structure + zip-bomb), SHA-256 dedup,
  filename sanitize.
PREFERRED: NO CHANGE

----------------------------------------------------------------------
ISSUE ID: PIPE-001 (symptom-class)
TITLE: Finalizer claim-metadata emptiness masked by calibrated fallback
STATUS: PARTIAL
TECHNICAL: when finalizer repeatedly returns empty claim provenance, the
  pipeline falls back to calibrated text + warning — document exists but
  claim-level provenance is degraded. Fact review still runs (safety OK).
ROOT CAUSE (deeper): why the model omits metadata is unresolved —
  prompt/schema expectation may exceed what the bounded prompt delivers.
CONFIDENCE: PARTIAL — fallback is correct behavior; root mismatch unproven.
PREFERRED: NO CHANGE now; log aggregation will reveal recurrence.

=====================================================================
END INVENTORY — see companion docs for subsystem detail
=====================================================================
