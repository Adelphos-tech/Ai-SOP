# API Contract Test Report — PHASE RELEASE-40

Date: 2026-09-17
Environment: `sop_ai_app_test` (isolated test DB on production host)
Test files: `tests/api-contract-tests.ts`, `tests/canonical-e2e-test.ts`
Run: `npx tsx tests/<file>` with `SOP_TEST_DB_*` env vars

## Coverage summary

| Area | Assertions | Result |
|------|-----------|--------|
| API contract tests (validation, status codes, prompt-source contract, ownership) | 42 | **42 PASS** |
| Canonical E2E journey (new applicant + existing student) | 19 | **19 PASS** |
| **Total** | **61** | **61 PASS** |

## Regression coverage for the reported production bugs

| Bug | Test | Result |
|-----|------|--------|
| resolve-prompt 400 on empty intake/intakeYear | `no intake/intakeYear -> 200`, `falls back to DEFAULT_TEMPLATE` | PASS |
| Document creation 403/500 for resolved prompts | `DVIVID_DEFAULT_TEMPLATE + template text -> 200`, `edited template -> CONSULTANT_PROVIDED`, `OFFICIAL_VERIFIED without WR id -> 400`, `bogus WR id -> 400 WRITING_REQUIREMENT_NOT_FOUND` | PASS |
| Generate blocked returning 403 | `incomplete profile -> 422 not 403`, `GENERATION_BLOCKED`, `blockReasons present` | PASS |
| Final export stale versionId | fixed in code; E2E approves + exports real PDF | PASS |

## Canonical E2E (API-level)

New applicant: create student → create application (no intake/year — the customer's exact bug path) → save full profile → readiness 6/6 → resolve-prompt → create doc from resolved template → save version → approve → **final PDF export (valid `%PDF-` bytes)** → draft DOCX export. **All PASS.**

Existing student: 2nd application → profile reused (no re-entry) → resolve → create doc. **All PASS.**

## What is NOT covered (and why)

| Endpoint/area | Reason untested |
|---|---|
| `POST /api/sop/generate*` (3 legacy bridge routes) | Legacy/test-harness routes, not canonical workflow |
| `POST /api/benchmark/run` | Internal benchmark harness; flagged for path-traversal hardening |
| `POST /api/application/cv-upload` + `cv-apply` | Require real CV file fixtures; covered by `phase-cv-parse-classification-tests.ts` + CV upload UI validation |
| `POST /api/requirements/discover`, `verify`, `save`, `resolve` | Discovery crawls external sites — not run in tests; `resolve` is a read path covered implicitly |
| `POST /api/requirements/library`, `lookup` GET | Read-only; lookup exercised via workspace page smoke test |
| `POST /api/auth/login`, `auth/session` | Auth is intentionally bypassed (dummy consultant); will need real tests when login is enabled |
| `GET /api/metrics` | Verified live on production earlier (external 401 / localhost 200); no handler-level test because localhost detection is header-based |
| AI pipeline (Planner→FactReviewer) | Real OpenAI calls — out of scope for contract testing by design; pipeline covered by phase-33/34 test suites |
| Actual AI generation | No OpenAI mock exists; generation gate verified via 422 contract + readiness unit checks |

## HTTP status semantics after fixes

- `400` malformed/missing/invalid input — verified across all tested routes
- `403` real authorization/ownership failures only (ownership mismatches verified)
- `404` missing resources — verified
- `422` business-prerequisite blocking (`GENERATION_BLOCKED` with `blockReasons`/`completenessIssues`) — verified
- `503` resource-busy / missing API key — verified (`OPENAI_API_KEY_REQUIRED`)
