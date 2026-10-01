# CUSTOM CODE REPLACEMENT MATRIX

| SUBSYSTEM | CURRENT IMPLEMENTATION | BUG HISTORY | MAINT. BURDEN | LIBRARY/SERVICE OPTIONS | MIGRATION | LOCK-IN | RECOMMENDATION |
|---|---|---|---|---|---|---|---|
| Resume semantic parsing | `cv-mapper-docling.ts` 581 LOC regex/state machine | **P0: table-DOCX → empty; DOCX name never extracted; no publications/volunteer slots; JULY/2022 dates; entity pollution** | HIGH — grows per resume format | **Affinda** (service, $0.10/doc + self-host), RChilli, Daxtra | LOW–MED (thin vendor→ParsedCV mapper; scaffold exists `scripts/affinda-benchmark`) | LOW (thin adapter) | **REPLACE WITH SERVICE (Affinda)** |
| Resume text extraction | Docling sidecar (FastAPI, 2.129.0) | PARTIAL — DOCLING_UNREADABLE on prod 655KB docx; no heading blocks for table-docx | MED | vendor handles files directly; mammoth fallback exists | n/a | — | **FALLBACK/REMOVE** — keep only as offline fallback once vendor parser lands |
| Legacy CV parser | `cv-parser.ts` 799 LOC + mammoth/pdf-parse | superseded by docling path; still reachable via `CV_PARSER_FALLBACK` | MED | — | low | — | **REMOVE** after vendor cutover (keep meanwhile as fallback) |
| DOCX validation | `docx-validator.ts` custom ZIP inspection + zip-bomb guard | none | LOW | — | — | — | **KEEP** (security-sensitive, already bounded) |
| PDF text extraction (requirements) | `pdf-extractor.ts` + pdf-parse | none known | LOW | — | — | — | **KEEP** |
| DOCX text extraction | mammoth (bounded) | none | LOW | — | — | — | **KEEP** |
| Date parsing (resume) | regex set in mapper | misses `JULY/2022`, `MM/YYYY`, parenthesized | MED | date-fns parse + chrono-node for fuzzy CV dates | LOW | none | **REPLACE (chrono-node)** if mapper retained; moot if Affinda lands |
| Section/heading detection | keyword regexes in mapper | **P0: misses non-`section_header` headings** | HIGH | purpose-built parser | — | — | **REPLACE WITH SERVICE** |
| Generation orchestration | `run-application-pipeline.ts` 1,588 LOC + stage-execution 649 | stage-order, cursor issues historically | HIGH | none — domain contract is D-Vivid-specific | — | — | **KEEP + SIMPLIFY** (split stage handlers; do not rewrite semantics) |
| OpenAI transport | `openai-transport.ts` 578 LOC — bg responses, fingerprint reuse, SLA, terminal classify | STAGE_TIMEOUT seen; raw provider strings leak into error field | MED–HIGH | SDK built-ins cover part; bg-response recovery is custom by necessity | — | — | **KEEP** (boundary logic is product-specific); **FIX** error normalization |
| Checkpoint/resume | `pipeline-checkpoint.ts` + `generation_stage_responses` fingerprint reuse | verified: stage-6 retry doesn't repay 1–5 | MED | none | — | — | **KEEP** |
| Generation lock | atomic conditional UPDATE w/ 10-min stale recovery | works (lock_conflict event correct) | LOW | Redis/GET_LOCK | low | — | **KEEP** — already DB-atomic & multi-process safe |
| Rate limiting | `rate-limiter.ts` in-memory Map | resets on restart; per-process | LOW | Upstash/DB buckets | MED | low | **KEEP for now** — single-process prod; document limitation |
| Resource limiting | `resource-limiter.ts` in-process semaphores | none | LOW | Bottleneck | LOW | none | **SIMPLIFY/KEEP** — fine at current scale |
| Requirements resolution | `resolver.ts`, `generation-context.ts`, discovery-pipeline 1,111 LOC | legacy-inheritance bug class (fixed); silent fetch failures | HIGH | — domain-specific | — | — | **KEEP + FIX silent catches** |
| Prompt resolution scope | `resolveAndMergePrompt` | **footgun: missing `useLegacyRequirements` silently flips behavior** | MED | — | — | — | **FIX** — make flag explicit at call sites |
| Rendering/page validation | `lib/render/*` — **headless Chromium via puppeteer in-process** + pdf-lib page count | resource-heavy; failure risk if chromium missing | HIGH | pdf-lib-only estimation, dedicated render worker, WeasyPrint | MED | none | **SIMPLIFY** — keep for model testing; extract to worker only if it destabilizes app |
| PDF export | `document-export.ts` + pdf-lib | none | LOW | — | — | — | **KEEP** |
| DOCX export | docx lib | none | LOW | — | — | — | **KEEP** |
| Rich text editor | tiptap | none | LOW | — | — | — | **KEEP** |
| Forms | RHF + zodResolver | none | LOW | — | — | — | **KEEP** (do not rewrite) |
| Schema validation | Zod canonical for AI stages | uniform in AI path; missing min-content gate on CV parse | LOW | — | — | — | **KEEP + extend to CV parse result** |
| Fact-reviewer output contract | `final-fact-reviewer.ts` prompt + Zod | **4.5–5k output tokens vs 3.5k target → STAGE_TIMEOUT** | MED | — | — | — | **FIX** — tighten output schema/prompt; keep budget |
| Logging | JSON console.log events | no rotation; field inconsistency (`error` vs `reason`) | MED | pino + standard codes | LOW | none | **FIX — standardize; don't replace** |
| HTML/entity handling | regex decode absent (`&#124;` leaked) | linkedin field pollution seen | LOW | `entities`/`he` decode | LOW | none | **FIX — add decode step** |
| Requirements discovery fetch | `discovery-pipeline.ts` + resolver fetch | silent `null` returns | MED | — | — | — | **FIX — surface failure states** |
| Dead routes | `api/sop/generate{,-application,-mit-cee}`, `api/benchmark/run`, `api/metrics` | — | LOW | — | — | — | **REMOVE candidates** — no UI callers found; verify before delete |
| Dead flags | `CV_PARSER_FALLBACK` unset everywhere; `OPENAI_BACKGROUND_RESPONSES_ENABLED` | — | LOW | — | — | — | **REMOVE legacy flag path post-vendor** |

## SILENT-FAILURE INVENTORY (Phase 4)

| LOCATION | PATTERN | SEVERITY |
|---|---|---|
| `cv-mapper-docling.ts` → cv-upload route | all content → PERSONAL segment → `success:true` + empty arrays, **zero warnings** | **P0** |
| `cv-mapper-docling.ts` name gate | `b.page===1` never true for DOCX → name silently absent | **P1** |
| `resolveAndMergePrompt` | missing `useLegacyRequirements` → silently new-doc behavior | **P1** |
| `requirements/resolver.ts:145,187` | fetch fail → `console.error` + `null` → caller can't distinguish "no info found" from "fetch failed" | **P2** |
| `requirements/requirements-db.ts:29,56`, `application-context-repository.ts:60,104`, `search-provider.ts:179`, `discovery-ai.ts:99,176` | catch → `null`/`[]` | **P2** |
| `pipeline-checkpoint.ts:260` | catch → `[]` | P3 (defensible — missing checkpoint = fresh run) |
| `docling-client.ts` | `DOCLING_UNREADABLE` flattens all 400s | **P2** |
| pipeline error field | raw provider error strings embedded (413/429 wall-of-text) | P2 |
| dedup meta reuse | gated by engine+mapperVersion ✓ (correctly NOT silent) | — |
