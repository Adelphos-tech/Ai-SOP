# PHASE SOP-INFRA-37 — INTERNAL ROUTING + REVERSE PROXY RESILIENCE AUDIT

**Project:** D-Vivid Application Writer
**Application:** /opt/sop-ai-app/
**Date:** 2026-09-12

---

## INCIDENT

**Exact failing URL:**
```
https://sop.adelphostech.com/api/application/document/generate
```

**Protocol used:** HTTPS (inherited from `req.url`)

**Target listener:** `127.0.0.1:5010` (plain HTTP — Next.js production server)

**Root cause:**
The `/api/sop/generate` route constructed an internal fetch URL using:
```ts
const generateUrl = new URL("/api/application/document/generate", req.url);
```
When a request arrived through nginx (HTTPS), `req.url` was `https://sop.adelphostech.com/...`.
The internal `fetch()` then attempted a TLS handshake against the Next.js server at `127.0.0.1:5010`, which only speaks plain HTTP. OpenSSL received HTTP response bytes as if they were TLS records, producing:
```
ERR_SSL_PACKET_LENGTH_TOO_LONG
```
(TLS record header expects a length field, but got raw HTTP — the "packet length" exceeded TLS maximum.)

**Flow:**
```
Browser → HTTPS → nginx (TLS termination) → HTTP → Next.js :5010
  → /api/sop/generate
  → new URL("/api/application/document/generate", req.url)
  → fetch("https://sop.adelphostech.com/api/application/document/generate")
  → HTTPS handshake to 127.0.0.1:5010 (plain HTTP)
  → ERR_SSL_PACKET_LENGTH_TOO_LONG
```

**Fix applied:** Removed the HTTP self-fetch entirely. Both routes now call a shared server-only function `generateApplicationDocument()` directly. No HTTP self-fetch occurs.

---

## SELF-FETCH

**Same-process self-fetches found:** 1
- `src/app/api/sop/generate/route.ts:272` — `fetch()` to `/api/application/document/generate` in the same Next.js process

**Removed:** 1

**Remaining:** 0

**Client-side fetches (not server-side self-fetch):** 2
- `src/lib/persistence/ProfileContext.tsx:64,96` — browser `fetch()` to `/api/application/profile` (legitimate client-to-server calls, not same-process self-fetch)

**External HTTP calls (genuine, retained):** 8
- `src/lib/requirements/discovery-scoring.ts` — external sitemap/URL crawling (10s timeout)
- `src/lib/requirements/search-provider.ts` — external search API (10-15s timeout)
- `src/lib/requirements/html-extractor.ts` — external HTML fetch (15s timeout)
- `src/lib/requirements/pdf-extractor.ts` — external PDF fetch (30s timeout)
- `src/lib/currency/exchange-rate.ts` — external exchange-rate API (10s timeout, added in this phase)

---

## GENERATION

| Component | Status |
|-----------|--------|
| Shared server service | **PASS** — `src/lib/application/generation-service.ts` |
| Legacy route | **PASS** — `/api/sop/generate` calls shared service directly |
| Canonical route | **PASS** — `/api/application/document/generate` calls shared service directly |
| HTTP self-call required | **NO** — both routes are thin transport adapters |

**Shared service performs:**
1. Relationship validation (`loadDocumentGenerationContext`)
2. API key check
3. Pre-generation block check
4. Atomic generation lock (`acquireGenerationLock`)
5. GenerationContract construction
6. Six-stage pipeline (`runApplicationPipeline`)
7. DocumentVersion persistence
8. Generation status update
9. FAILED status on any error

**No duplicate generation logic exists.** Both routes delegate to the same function.

---

## PROXY

| Component | Status |
|-----------|--------|
| TLS termination | nginx (port 443) — terminates TLS |
| Next.js listener | `127.0.0.1:5010` — plain HTTP, loopback only |
| Forwarded headers | **PASS** — `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` all set |
| Port 5010 externally reachable | **NO** — bound to 127.0.0.1, not 0.0.0.0 |

**nginx config verified:**
```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

---

## DEPLOYMENT

| Component | Status |
|-----------|--------|
| Clean build | **PASS** — `npm run build` succeeded |
| Old build survives failed build | **YES** — safe deploy script builds first, restarts only on success |
| Intentional restart count | 1 (171 → 172) |
| Unexpected restart | 0 |

**Safe deployment script:** `scripts/phase-37-safe-deploy.sh`
- Records PM2 restart count before deployment
- Builds with `NEXT_PUBLIC_BUILD_ID` env var
- Only restarts PM2 if build succeeds
- Verifies HTTP 200 after restart
- Reports restart delta (expected: exactly 1)

---

## SERVER ACTIONS

| Question | Answer |
|----------|--------|
| Stale deployment errors confirmed | **YES** — `Failed to find Server Action "x"` errors in logs |
| Cause | Stale browser tabs from before the latest deployment |
| Current refreshed clients affected | **NO** — errors only occur with old build IDs |
| Recovery | User refreshes browser — stale-client notice banner added |

**Stale-client refresh notice:** Added to `AppShell.tsx`. Detects Server Action errors and shows a non-intrusive banner: "A new version of D-Vivid is available. Refresh to continue."

---

## OBSERVABILITY

Structured JSON logging added to `generation-service.ts`:
```json
{"event":"generation_service_start","requestId":"...","studentId":"...","applicationId":"...","documentId":"...","buildId":"deploy-20260912080544-nogit"}
{"event":"generation_context_failed","requestId":"...","documentId":"...","error":"Student not found","durationMs":22}
{"event":"generation_lock_conflict","requestId":"...","documentId":"...","durationMs":5}
{"event":"generation_service_success","requestId":"...","generationId":"...","versionId":"...","versionNumber":1,"durationMs":45000}
```

**Build ID:** `NEXT_PUBLIC_BUILD_ID` env var set at deploy time. Included in every log entry. Enables correlating "Failed to find Server Action" errors with specific deployments.

---

## ERROR SANITIZATION

Error responses now sanitize internal details:
- `127.0.0.1:5010` → `[internal]`
- `localhost:5010` → `[internal]`
- `/opt/sop-ai-app/...` → `[path]`
- `ERR_SSL_PACKET_LENGTH_TOO_LONG` → `[ssl-error]`
- Messages truncated to 500 characters

No stack traces, internal IPs, ports, or file paths exposed to clients.

---

## TIMEOUTS

All external HTTP calls have bounded timeouts:

| Call | Timeout |
|------|---------|
| Sitemap crawl | 10s |
| Sub-URL crawl | 10s |
| Search provider | 10-15s |
| HTML extractor | 15s |
| PDF extractor | 30s |
| Exchange-rate API | 10s (added in this phase) |
| OpenAI pipeline | 300s (maxDuration — bounded by Next.js) |

No internal fetches that can hang indefinitely (no self-fetches remain).

---

## TESTS

| Test | Status |
|------|-------|
| Internal HTTP origin independent | **PASS** — shared service has no `req.url`, `127.0.0.1`, `sop.adelphostech.com`, or `INTERNAL_API_BASE` references |
| HTTPS entry | **PASS** — `https://sop.adelphostech.com/api/sop/generate` returns controlled response, no SSL error |
| HTTP entry | **PASS** — `http://127.0.0.1:5010/api/application/document/generate` returns same controlled response |
| No recursive route call | **PASS** — shared service has no `fetch()` and no `/api/` path in code |
| No OpenAI calls | **PASS** — tests use blocked-path (invalid IDs, missing fact sheet approval) |
| Self-fetch static audit | **PASS** — 0 violations found |
| Canonical route tests (A-L) | **PASS** — 36/36 tests passed |

---

## PRODUCTION CHECK

| Check | Result |
|-------|--------|
| Public frontend | 200 |
| SOP HTTPS entry | 200 (no SSL error) |
| SOP local HTTP entry | 200 (same behavior) |
| nginx | active |
| PM2 restart delta | 1 (expected) |
| Production DB | unchanged (test data cleaned up) |

---

## FILES MODIFIED

1. `src/lib/application/generation-service.ts` — **NEW** — shared canonical generation service
2. `src/app/api/application/document/generate/route.ts` — thin adapter, calls shared service, error sanitization
3. `src/app/api/sop/generate/route.ts` — thin adapter, calls shared service (no self-fetch), error sanitization
4. `src/components/layout/AppShell.tsx` — stale-client refresh notice
5. `src/lib/currency/exchange-rate.ts` — added 10s timeout

## FILES ADDED

1. `scripts/phase-37-self-fetch-audit.ts` — static audit test for self-fetch patterns
2. `scripts/phase-37-canonical-route-tests.ts` — canonical route tests (A-L)
3. `scripts/phase-37-safe-deploy.sh` — safe atomic deployment script

---

## RESULT

**INTERNAL ROUTING RESILIENT: YES**

- No same-process HTTP self-fetch remains
- Both generation routes call a single shared service function
- Generation logic is independent of public origin (no `req.url`, `Host`, `x-forwarded-*` dependency)
- HTTPS and HTTP entry points behave identically
- Error responses are sanitized
- Structured logging with requestId/generationId/buildId
- Stale-client refresh notice added
- Safe deployment script prevents destroying a working build on build failure

---

PHASE SOP-INFRA-37 COMPLETE — INTERNAL ROUTING AND PROXY BOUNDARY HARDENED
