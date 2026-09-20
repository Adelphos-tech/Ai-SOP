# DOCLING PRODUCTION SIDECAR DEPLOYMENT

**Date:** 2026-09-20 · **Host:** sop.adelphostech.com · **OPENAI calls:** 0 · **Generations:** 0 · **Profile writes:** 0

## Pre-install snapshot

```
disk free before:   43G (54%)
RAM before:         13Gi available
swap:               8Gi
load average:       0.28 / 0.36 / 0.30 (6 cores)
PM2 sop-app:        online, 66MB
```

## Deployment

- **Service path:** `/opt/sop-ai-services/cv-parser/` (venv + code + `cache/` — outside all release dirs; deploy pruning never touches it)
- **Python env:** isolated venv, `docling==2.129.0` pinned (torch 2.14, transformers 5.17)
- **Model cache:** `HF_HOME=/opt/sop-ai-services/cv-parser/cache` — 506MB of models, documented location (NOT /root/.cache)
- **Manager:** systemd `sop-ai-cv-parser.service` — enabled (starts on boot), `Restart=on-failure`, logs → `/opt/sop-ai-services/cv-parser/service.log`
- **Bind:** `127.0.0.1:8099` only — verified via `ss -tlnp` (not on public interface, not in nginx)
- **Warm-up:** first production parse = known failing CV (validation below); models loaded during it

## Measured resources

| | |
|---|---|
| Idle RSS | 683 MB |
| Cold parse | **22s** (incl. model download) |
| Warm parse | **4s** (server-side 2.4s) |
| Peak parse RSS | **1.84 GB** |
| Steady RSS after parses | ~1.7 GB |
| Total footprint | 6.1 GB (venv+deps) + 0.5 GB models |
| Disk after | 33G free (65%) |
| RAM after | 12Gi available |

## Non-writing production validation — the actual failing CV

Same file that produced 21 bogus education rows under legacy:

| | LEGACY | DOCLING (prod) |
|---|---|---|
| education | 21 bogus | **1** — Indus University · B.Tech CSE · 8.47/10 · 2022–2026 |
| experience | 0 | **3** — Sustainalyze, Petpooja, Prodigy Infotech |
| projects | 15 | **4** |
| certifications | 4 | **7** |
| "India" institution | YES (legacy bug) | **NO** |
| sentence institution | YES (legacy bug) | **NO** |
| invented defaults | none | **NO** |

Run via `scripts/compare-cv-parsers.ts` on the prod host — extraction + mapper + Zod + sanity only. **Zero profile writes. cv-apply never called.**

## Activation

`/opt/sop-ai-app/.env.local`:

```
CV_PARSER_SERVICE_URL=http://127.0.0.1:8099
CV_PARSER_TIMEOUT_MS=120000   # covers ~22s cold starts with headroom
CV_PARSER_ENGINE=docling
# CV_PARSER_FALLBACK unset → no silent legacy fallback
```

## Failure contract

`DoclingServiceError` codes: `DOCLING_UNREACHABLE / DOCLING_TIMEOUT / DOCLING_UNREADABLE / DOCLING_BAD_RESPONSE` → controlled 400 with parser-specific message (never generic 500, never partial data applied). Temp files: `NamedTemporaryFile(delete=True)` — auto-removed on success/error/timeout; validation copies cleaned manually.

## Rollback (no code change needed)

```
sed -i 's/CV_PARSER_ENGINE=docling/CV_PARSER_ENGINE=legacy/' /opt/sop-ai-app/.env.local
pm2 restart sop-app --update-env
```

Sidecar stays installed but unused.

## Report

```
DOCLING VERSION: 2.129.0
SERVICE PATH: /opt/sop-ai-services/cv-parser/
SERVICE MANAGER: systemd (sop-ai-cv-parser.service, enabled, restart=on-failure)
SERVICE STATUS: ACTIVE
BIND: 127.0.0.1:8099
PUBLICLY EXPOSED: NO
HEALTH: 200
DISK BEFORE: 43G free | DISK AFTER: 33G free
DOCLING + MODEL DISK: ~6.6G total
RAM BEFORE: 13Gi avail | IDLE: 683MB | PEAK PARSE: 1.84G | STEADY: ~1.7G
COLD PARSE: 22s | WARM PARSE: 4s
CV_PARSER_ENGINE: docling
AUTOMATIC LEGACY FALLBACK: NO
IDENTITY GUARD / CV REVIEW / MERGE-REPLACE / REVISION GUARD: UNCHANGED
PROFILE WRITES DURING VALIDATION: 0
OPENAI CALLS: 0 · DOCUMENT GENERATIONS: 0
```

DOCLING PRODUCTION SIDECAR DEPLOYED — READY FOR USER MANUAL CV TEST
