# Release Blockers — PHASE RELEASE-40

Date: 2026-09-17

## CRITICAL

**None remaining.** All critical workflow bugs found during this audit were fixed and verified by automated tests:

- ~~Document creation rejected all resolved prompts (403/500)~~ → FIXED + regression-tested
- ~~Final export always sent stale versionId (400)~~ → FIXED + E2E-verified (real PDF bytes)
- ~~Required "Work Experience" section uncompletable for freshers~~ → FIXED (`noWorkExperience` flag)
- ~~Generation blockers returned 403 with hidden reasons~~ → FIXED (422 + rendered `blockReasons`)
- ~~resolve-prompt 400 on empty intake/intakeYear~~ → FIXED (fields now optional; 61 test assertions pass)

## HIGH

**None remaining.**

## Known limitations (documented, not blockers)

| Item | Severity | Note |
|------|----------|------|
| Consultant auth bypassed | By design | `requireConsultantSession` returns dummy ADMIN; `/api/metrics` has independent protection |
| LOR recommender intake | MEDIUM | No intake section collects recommender context; LOR generation requires `experience[]` or legacy recommender fields — flagged for a future intake addition |
| `/applications` + `/requirements-library` orphaned | LOW | Reachable only by URL; not linked in header |
| `benchmark/run` file-path input | LOW (internal) | Test harness; not part of consultant workflow |
| `auth/login` rate limit unimplemented | LOW | Login disabled |
| AI generation E2E | — | Real OpenAI call not exercised in automated tests (no mock infra); generation contract verified to the 422 gate |

## Production verification checklist before customer re-test

1. Customer's application `140fe367` (Moksh Goswami) has empty `intake`/`intakeYear` — now safe; resolve-prompt will fall back to the default template instead of 400ing.
2. Their existing document `f34415b0` can be opened and generated normally.
