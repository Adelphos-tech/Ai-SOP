# CV OBSERVABILITY AUDIT
Audit-only. Covers cv-upload (multi-strategy import) + cv-apply.

## 1. Structured events emitted

| Event | Caller | Fields | Severity |
|---|---|---|---|
| `cv_import_result` | cv-upload route | studentId, mimeType, fileSize, buildId, reason(import state), diagnostics{strategy, coverage, rawTextLength, sections, fallbackUsed, attempts:"strat:status/coverage,..."} | info (console.log) |
| `cv_parse_failure` | cv-upload route | studentId, mimeType, fileSize, buildId, reason(normalized code), diagnostics | error |
| `cv_parse_stale_meta_reparse` | cv-upload route | studentId, mimeType, fileSize, buildId, reason("old@ver → new@ver") | info |
| `cv_upload_error` | cv-upload route | studentId("unknown"), mimeType("unknown"), fileSize(0), buildId, reason(error.code) | error |
| `[cv-apply] IDENTITY_CONFLICT_OVERRIDE` | cv-apply route | studentId, **student name**, **cv name+email**, consultant.id | warn — **PII** |
| `[cv-apply] REPLACE_CV_DERIVED` | cv-apply route | studentId, consultant.id, removedCvItems (count) | warn |
| `CV apply error:` | cv-apply route | raw error object | error — unstructured |

## 2. Per-strategy field audit (spec §11)

| Field | MAMMOTH_SEMANTIC | DOCLING_MAPPER | TEXT_EXTRACTION |
|---|---|---|---|
| file type | yes (mimeType) | yes | yes |
| file size | yes | yes | yes |
| strategy name | yes (attempts chain) | yes | yes |
| duration per strategy | **no** | **no** | **no** |
| raw text length | yes (winner only) | via attempts coverage | yes |
| coverage state | yes | yes | yes |
| personal/education/experience/skills counts | **no** (only coverage.sectionCount) | no | no |
| failure code | yes (normalized) | yes | yes |
| fallback attempted | yes (fallbackUsed flag) | yes | yes |
| winner strategy | yes | yes | yes |

**Can we reconstruct why one parser beat another?** Partially — the `attempts` string shows each strategy's status + coverage ranking basis, and `coverage`/`rawTextLength` for the winner. **Missing: per-strategy duration, per-section extraction counts, and the reason a losing strategy's coverage scored lower.** The ranking function itself (coverage-ranked selection) is implicit — you'd infer it from attempts order + coverage values.

## 3. CV apply audit trail

| Required | Present? |
|---|---|
| which parsed CV applied | fileHash in upload response; apply body carries parsedCV — **not logged at apply time** |
| which strategy generated it | `parserMeta.sourceStrategy` in stored meta — **not logged in apply events** |
| which applicant | studentId — yes |
| profile fields changed | only `removedCvItems` count (REPLACE mode); **no per-field/per-section change counts** |
| identity conflict result | status returned to client; override decision logged (with PII) |
| replace vs merge | replaceCvDerived branch logged; plain merge/overwrite path **not logged** |
| revision transitions | profileRevision check 409 logged? **No** — rejection returned silently |
| failure reason | raw `console.error("CV apply error:", error)` — unstructured |
| profile mutation occurred | only inferable from success response; **no apply-completed audit event** |
| parse retried / fallback used | in upload events, not in apply |

## 4. PII findings (CV subsystem)

1. **`[cv-apply] IDENTITY_CONFLICT_OVERRIDE` logs student name + CV name + CV email** — clear PII in PM2 logs. Severity: HIGH.
2. `cv-apply` 500 catch returns `error?.message` raw to client AND logs full error object (may contain DB/SQL detail referencing student data). Severity: MEDIUM.
3. `cv_parse_failure` diagnostics are content-free by design — good. `extractedText` returned to client only (not logged) — good.
4. `student-delete` warn logs `name="first last" email=` — PII (documented in LOG_RETENTION_AND_PII_AUDIT.md).
5. `plan-sop.ts:34` logs first 200 chars of planner output on parse error (generation-side, CV-adjacent content leak).

## 5. Gaps summary

- **P1**: no apply-completed audit event (fields changed, strategy source, revision) — the only mutation of student profile data is nearly unlogged.
- **P2**: no per-strategy duration; no per-section extraction counts (personal/education/experience/skills) — needed to answer "why did DOCLING lose to TEXT_EXTRACTION".
- **P2**: PROFILE_CHANGED 409 and IDENTITY_CONFLICT (non-override) rejections not logged — silent consultant-facing friction.
- **P1**: PII in override warn log; raw error object + raw message in apply 500.
- Event format inconsistency: JSON.stringify events in upload vs bracket-prefix text warns in apply.
