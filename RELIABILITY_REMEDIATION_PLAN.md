# RELIABILITY REMEDIATION PLAN

Ordered, independently testable. No rewrites. 0 paid OpenAI calls.

**Wave 0+1 status (2026-09-30):** 1A ✅ done (CV_PARSE_EMPTY_STRUCTURE
gate + diagnostics live, Khushi file verified), 1B ✅ investigated —
root cause PROVIDER_SLOW not verbosity (see below), 1C ✅ done
(`useLegacyRequirements` now compile-required on
`ResolverDocumentInput`), 1D partially done (DOCX `page=null` name gate
fixed + fixture test; section-detection fallback/date-grammar widening
still pending — superseded if Affinda lands).

---

## WAVE 1 — P0/P1 RELIABILITY (highest bug density per LOC)

### 1A. Kill the silent-empty CV parse class *(P0)*
- Add a **minimum-content gate** after `mapDoclingToParsedCV` in
  `cv-upload/route.ts`: if `education+experience+skills+certs+achievements`
  are all empty AND `rawTextLength > N`, return deterministic failure
  (`CV_PARSE_EMPTY_STRUCTURE`) instead of `success:true`. Same class the
  Khushi incident was — never return success-with-nothing.
- Deterministic test: feed a `ParsedDocument` with no
  `section_header`/`title` blocks → expect failure, not empty success.

### 1B. Fact-reviewer timeout *(P0 — paid-work loss)*
- **CORRECTION (Wave 0):** `FACT_REVIEW_OUTPUT_VERBOSE` is *correlated*
  with the timeout, not proven causal. Wave-1 must first classify:
  PROVIDER_SLOW / LOCAL_SLA_TOO_SHORT / POLLING_RECOVERY_BUG /
  OUTPUT_CONTRACT_TOO_VERBOSE / UNKNOWN using the failed run's provider
  timeline before any tuning.
- Only after root cause is proven: tighten the output contract (bound
  per-claim verdict text, drop redundant evidence-echo fields) and/or
  adjust `OPENAI_STAGE_SLA_FACT_REVIEWER_MS`. Never raise SLA before
  the contract is proven to be the cause.
- Add regression test: mock fact-reviewer → assert retry-after-timeout
  resumes at stage 6 via `findReusableProviderResponse` (no re-pay).

### 1C. `useLegacyRequirements` footgun *(P1)*
- Make the flag a **required** field on the resolver input type so
  call sites can't silently omit it; fix
  `resolved-requirements-display.test.ts` fixtures (add flag matrix).

### 1D. CV parse quality details *(P1, if vendor not yet landed)*
- Section detection fallback: also treat ALL-CAPS `text` blocks ≤40
  chars as heading candidates (fixes Khushi-class docs).
- Decode HTML entities (`&#124;` → `|`) before field extraction.
- Extend `SECTION_KEYWORDS`: `volunteer`, `research`, `publication`,
  `achievements`, `declaration`, `references`.
- Extend date grammar: `MM/YYYY`, `MONTH/YYYY`, parenthesized ranges.
- Remove `b.page===1` gate for DOCX (or accept `page==null`).

---

## WAVE 2 — LIBRARY/SERVICE REPLACEMENTS

### 2A. Resume parser → Affinda *(the big win)*
- `scripts/affinda-benchmark/` scaffold exists (corpus: Khushi, Shivang
  docx+pdf, synthetic fixtures). Needs `AFFINDA_API_KEY` (free trial,
  1,000 docs).
- Benchmark corpus: real CVs + generated fixtures (table-docx,
  two-col, academic, healthcare, fresher, scanned).
- Gate: Affinda must hit ≥90% structural minimums vs current pipeline's
  Shivang/Kunj baselines **and** solve Khushi.
- Target: file → Affinda `/v1/resumes/parse` → thin
  `affinda→ParsedCV` adapter → existing Zod + sanity + review → apply.
  ~200 LOC adapter replaces ~1,400 LOC (mapper + sanity compensations).
- Docling demoted to offline fallback/diagnostic.
- Privacy: cloud API is stateless per vendor docs; flag for user
  decision (self-hosted exists at license cost — deferred).

### 2B. Dead code removal (verify zero callers, then remove)
- `api/sop/generate{,-application,-mit-cee}` routes (no UI callers)
- **HOLD until Affinda benchmark + cutover complete:** legacy
  `cv-parser.ts` path and `CV_PARSER_FALLBACK` env flag — they are the
  only offline fallback today. Do not remove in Wave 0/1.
- stale test `phase-12b-runner-mock` (fix harness or retire)

---

## WAVE 3 — SIMPLIFICATION & ERROR MODEL

### 3A. Standardize error codes (Phase 20)
Central enum: `TECHNICAL / DATA / CONTENT / QUALITY / COMPLIANCE /
TRANSIENT_PROVIDER / USER_ACTION_REQUIRED`. Replace raw provider
message leakage in `generation_pipeline_error.error` with
`PROVIDER_QUOTA`, `PROVIDER_REQUEST_TOO_LARGE`, etc. (details in
separate `detail` field, truncated).

### 3B. De-silent the requirements layer
`resolver.ts`, `requirements-db.ts`, `discovery-ai.ts`,
`application-context-repository.ts`, `search-provider.ts`: distinguish
**fetch-failed** from **not-found** — propagate a status enum instead
of `null`/`[]` where callers need it (resolve-prompt UI hints).

### 3C. Pipeline file split (no semantic change)
`run-application-pipeline.ts` 1,588 LOC → per-stage handler modules
under `pipeline/stages/`. Pure mechanical extraction, same behavior —
makes the next generation bug readable.

### 3D. Docling error granularity
Sidecar returns 400 for everything unreadable → split into
`EMPTY_EXTRACTION`, `CORRUPT_DOCX`, `IMAGE_ONLY` so UI can give the
right instruction.

### 3E. Golden fixture governance
- Add integrity check: fixture manifest + expected-key assertions so a
  drifted `generation-contract-approved.json` fails loudly with
  "fixture drift" not `undefined[0]`.
- Regenerate the phase-17 fixture or adapt the test to current contract.

---

## WAVE 4 — CLEANUP (do only after 1–3 settle)

- Configure ESLint (`next/core-web-vitals`) + CI lint step.
- **Stale `deploy/` parallel tree**: `deploy/src/`, `deploy/tests/` and
  `deploy/tsconfig.json` are an outdated Sept-9 copy of the requirements
  engine (resolver.ts already differs from server-12b's). The tsconfig
  emits a permanent IDE error (`types: ["node"]` with no package.json/
  node_modules at that level). Verify zero usage → delete the whole
  stale tree or archive it outside the workspace.
- Puppeteer render-validation: measure real cost on prod; if it ever
  destabilizes the app, move to a render worker or pdf-lib-only
  estimation. Not urgent at testing scale.
- Rate limiter: document process-local limitation; defer DB-backed
  buckets until multi-instance exists.
- `dep` audit: pdf-parse vs docling overlap (keep — different jobs),
  puppeteer heavyweight dep (document reason).
- `generation_status` doc state: expose FAILED w/ stage + retry hint to UI.
- Log rotation for PM2 logs (`pm2-logrotate`) — error history currently
  evaporates on flush.

---

## DECISION RULES APPLIED (Phase 27/28)

Kept custom (domain core): generation contract, evidence selection,
claim provenance, requirement resolution, CV-merge policy, narrative
profiles, document-type configs, fact-safety rules, consultant workflow,
DB repo + transactions, generation lock, checkpoint/resume.

Replaced (generic infra): resume semantic parsing → Affinda;
resume date grammar → vendor (or chrono-node interim).

## RISKS / NOTES

- Affinda sends CVs to a third-party API — needs explicit user go/no-go
  on data privacy before Wave 2A. Self-hosted container exists but
  licensed (~$12k/yr floor) — overkill now.
- Stage-SLA bumps must follow output-contract fixes, never precede.
- `useLegacyRequirements` change is API-shape-only — no DB migration.
- Puppeteer-in-app is the largest hidden resource risk; keep a watch.
