# FREE / OPEN-SOURCE LIBRARY REPLACEMENT AUDIT

Audit only — no installs, no recommendations for paid services. For each
custom component: current complexity, known bugs, candidate, and whether the
candidate actually solves the ROOT issue.

## 1. OCR (for image-only CVs — CV-005)

| Candidate | License | Docx-image support | PDF | Accuracy | CPU/RAM | Install | Maintenance |
|---|---|---|---|---|---|---|---|
| **Tesseract.js** | Apache-2.0 | YES (extract embedded images → OCR) | via pdf→image step | moderate on clean scans | ~300MB worker, CPU-bound | `npm i tesseract.js` | active |
| Tesseract (native) via sidecar | Apache-2.0 | same | same | better (newer engine builds) | similar | system package | very active |
| PaddleOCR | Apache-2.0 | yes | yes | high, esp. multi-lang | heavy (~1-2GB model) | Python env | active but heavy |
| OCRmyPDF | MPL-2.0 | NO (pdf only) | YES | wraps tesseract | moderate | system + deps | active |
| Docling OCR | MIT | yes — Docling already integrates OCR backends | yes | backend-dependent | existing sidecar | already deployed | — |

**Verdict:** For DOCX image extraction + OCR, the lightest correct path is
extract embedded media (already have ZIP access via validateDocx) →
**Tesseract.js** (native dep-free) or reuse the existing Docling sidecar
with an OCR backend enabled. Docling-with-OCR is likely cheapest since the
sidecar already runs. PaddleOCR is overkill at model-testing scale.

## 2. Resume parsing

| Candidate | Assessment |
|---|---|
| open-resume parser libs | mostly stale, US-format-centric — would NOT fix CV-001 (structure-gated mapping is OUR bug, theirs is worse) |
| sovren/hr-xml | paid — excluded |
| keep custom multi-strategy | **RECOMMENDED** — the strategy architecture is sound; CV-001/002 are coverage-ranking + mapper issues, not "wrong library" issues |

No free library matches the consultant-review pipeline semantics.
**Custom infra should remain.**

## 3. File-type detection

| Candidate | License | Value |
|---|---|---|
| `file-type` (npm) | MIT | replaces hand-rolled magic-byte checks — modest win, well-maintained |

Current custom checks are ~15 lines and correct. **KEEP custom** — swap
only if formats multiply.

## 4. Locking

| Candidate | License | Value |
|---|---|---|
| `proper-lockfile` | MIT | PID-stale handling, mtime stale checks — mature |
| current custom lock | — | works, but PID-reuse edge exists |

Current lock is ~80 lines and correct for single-host. `proper-lockfile`
would reduce custom surface and handle PID-reuse/stale-mtime better.
**Candidate for swap when touching lock code again** — not urgent.

## 5. Retry / backoff

Current: bounded in-run + fingerprint dedup + recovery — application-level
semantics no generic lib encodes. **KEEP custom.** (p-retry etc. only cover
the loop, not the checkpoint accounting.)

## 6. Queueing / background jobs

| Candidate | Value |
|---|---|
| BullMQ (+Redis) | durable queue would fix GEN-006 (GET-with-side-effects) and GEN-010 (single-instance assumption) |
| pg-boss / graphile-worker | Postgres-based — but DB is MySQL |
| node resque variants | Redis-dependent |

BullMQ is the right *eventual* shape but adds Redis infra — disproportionate
at model-testing scale. **KEEP current; revisit pre-production.**

## 7. Date parsing / HTML entity decoding

| Component | Custom status | Candidate |
|---|---|---|
| date parsing in mappers | small, CV-specific formats | `chrono-node` (MIT) if ambiguity grows — current code adequate |
| entity decoding | trivial | `he` or built-ins — no issue found |

**KEEP custom.**

## 8. PDF/DOCX processing

Already using: mammoth, pdf-parse/pdf-lib, Docling sidecar, JSZip.
No replacement needed — the right libraries are in place.

## 9. Rendering

| Candidate | Value |
|---|---|
| puppeteer pool (`puppeteer-cluster` or manual pool) | fixes RENDER-001 fresh-launch cost |
| playwright pool | alternative engine — no strong reason to switch |

**KEEP puppeteer; add pooling at scale.** `puppeteer-cluster` (MIT) is a
drop-in when needed.

## 10. Logging

| Candidate | Value |
|---|---|
| pino | structured + rotation transports — would fix OPS-001 partially |
| current jsonl appenders | work, unbounded |

`pino` (MIT) is a cheap correctness win for rotation/redaction guarantees.
**Reasonable future swap** — not blocking.

## Summary table

| Component | Verdict |
|---|---|
| resume parsing | KEEP custom (strategy arch correct) |
| OCR | ADD when green-lit — Tesseract.js or Docling-OCR |
| file-type | KEEP (custom adequate) |
| locking | CANDIDATE — proper-lockfile on next touch |
| retry | KEEP custom |
| queue | KEEP now; BullMQ pre-production |
| date/entity | KEEP |
| pdf/docx | KEEP (mature libs already used) |
| rendering | KEEP + pool later |
| logging | CANDIDATE — pino for rotation/redaction |
