# LOG RETENTION AND PII AUDIT
Audit-only.

## 1. Log topology

| Sink | Contents | Configured retention |
|---|---|---|
| PM2 stdout/stderr (default `~/.pm2/logs/*.log` on server) | All console.* — structured events + raw error objects | **NONE** — no `ecosystem.config.*` in repo, no `pm2-logrotate`, no logrotate config found; `ci-deploy.sh` runs `pm2 restart --update-env` only |
| `logs/openai-usage.jsonl` (cwd-relative, on server) | usage/cost rows | **NONE** — append-only forever |
| `logs/requirements/*.json` | verified briefs incl. provenance | append-only; deleteBrief exists (cache invalidation) |
| `logs/attempts/<genId>/` | checkpoint-*.json, artifact-*.json, **raw-*.txt (full stage output)**, accounting.json, run-state.json | **NONE** — accumulates forever |
| `logs/application-contexts/`, `logs/live-generations/`, `logs/attempts/`, `logs/phase-*` | misc JSON | none |

Deploy excludes `logs/` from rsync → server-side `logs/` persists across deploys and grows unboundedly.

## 2. "How far back can we reliably investigate?"

**No guaranteed window.** PM2 default logs grow until disk pressure or manual
flush; nothing in the repo config (`deploy.yml`, `ci-deploy.sh`, no ecosystem
file) sets `max_size`/`retain`/rotation/compression. `pm2 restart` on deploy
does not truncate logs, so the practical window is *since last `pm2 flush` /
log wipe / disk-full event* — which is unknowable from the repo. Effective
answer: **unbounded growth, zero guaranteed retention; realistically
days-to-weeks depending on volume and disk**. The usage ledger and attempt
artifacts persist longer but are on-disk JSON only, excluded from deploy sync —
they survive deploys but are never shipped anywhere durable.

## 3. PII / secret leakage inventory

| # | Location | Leaks | Severity |
|---|---|---|---|
| 1 | `cv-apply` `IDENTITY_CONFLICT_OVERRIDE` warn | student **name**, CV **name + email** | HIGH |
| 2 | `student/delete` warn | `name="first last"`, `email=` | HIGH |
| 3 | `logs/attempts/<id>/raw-*.txt`, `artifact-*.json` | **full document bodies / stage output containing applicant facts** | HIGH (content artifacts, no purge) |
| 4 | `plan-sop.ts:34` | first **200 chars of model output** on parse error | MEDIUM (PII-adjacent content in PM2 logs) |
| 5 | `generation_runs.failure_message` via CONTENT_JSON_INVALID message | embeds **80 chars of model output** | MEDIUM (DB column, not a log — but same class) |
| 6 | `application/delete` warn | university name (context, mild) | LOW |
| 7 | `document/delete` warn | document title (may contain student name) | MEDIUM |
| 8 | ~15 `console.error("X:", error)` sites | full error objects — mysql2 errors can carry `sqlMessage`/sql text; OpenAI errors carry provider error bodies | MEDIUM (unbounded field exposure) |
| 9 | cv-apply 500 | `error?.message` raw to client | MEDIUM |
| 10 | Requirements resolver/discovery errors | URLs logged (university name in URL) | LOW |

**API keys / Authorization headers / full provider request bodies: NONE found
logged.** Provider request bodies are never logged; only `e.message` fragments
propagate (except the content-prefix leaks above).

## 4. Security-event observability gaps

- Auth: no structured login success/failure events — only `console.error("Login error:", error)` on exception. No lockout/brute-force trail. (Login disabled per project decision, but the code path still exists.)
- Rate limiting: `checkRateLimit`/`cvParseLimiter`/`renderLimiter`/`exportLimiter`/`crawlLimiter` rejections produce **zero log events** — abuse and pressure signals invisible.
- Delete routes do warn with actor (`consultant=id`) — good pattern, but PII-tainted (items 1,2,7 above).
- No separation between security events and operational logs (all PM2 stdout).

## 5. Recommendations (design only — no implementation in this audit)

1. PM2 `ecosystem.config.js` or `pm2-logrotate` with max_size, retain N days,
   compress, `merge_logs` — or a logrotate.d entry; document the retention target.
2. Ship usage JSONL + attempt metadata (not content) to durable store; put
   `logs/attempts/**` under a purge policy (e.g. keep N days, strip raw-*.txt
   on completion).
3. Scrub the identified PII sites (name/email → ids; content prefixes → length
   + hash); keep consultant-id actor fields.
4. Structured security events for auth + rate-limit rejections.
