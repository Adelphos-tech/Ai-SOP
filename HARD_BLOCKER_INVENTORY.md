# HARD BLOCKER INVENTORY

Every place in the product that can stop consultant progression, with classification.
Classification legend (per spec): **A** = required hard blocker · **B** = should recover automatically · **C** = should warn not block · **D** = consultant decision.

## CV intake / parsing

| Blocker | Location | Trigger | Blocks | Class | Recovery |
|---|---|---|---|---|---|
| File type validation | `cv-upload/route.ts` | non-DOCX/PDF/TXT extension | CV upload | A (data-integrity) | Upload supported file |
| File size cap | `cv-upload/route.ts` | >10 MB | CV upload | A (resource) | Smaller file / manual intake |
| Rate limit | `cv-upload/route.ts:109` | burst uploads | CV upload | A (resource, transient) | Wait and retry |
| `CV_EXTRACTION_EMPTY` | `cv-parser.ts` | zero usable content incl. OCR | parse only | A — but manual intake is the escape | Enter details manually |
| `CV_OCR_EXTRACTION_FAILED` | sidecar `/ocr` | OCR engine error on image-only file | parse only | B→A if persistent | Retry; manual intake escape |
| `CV_OCR_LIMIT_EXCEEDED` | `ocr_extract.py` | >10 pages/images, >20M px | parse only | A (resource) | Manual intake |
| Optimistic-concurrency CONFLICT | `cv-apply/route.ts:65` | stale profile revision | apply | A (data-integrity) | Reload and re-apply |
| Apply preview never auto-writes | cv-apply | by design | — | A (intentional) | Consultant clicks Apply |

## Application / document

| Blocker | Location | Trigger | Blocks | Class | Recovery |
|---|---|---|---|---|---|
| Application create field validation | `create/route.ts` | missing university/program | create | A | Fill fields (any country/degree accepted) |
| Document create validation | `document/route.ts` | missing type | create | A | Pick type |
| ~~Add Document gated on intakeComplete~~ | application `page.tsx` | any of 6 intake sections incomplete | document creation | **was C-made-A — FIXED this audit** | Now always available; server gate is authority |
| LOR recommender gate | `generation-context.ts` | LOR doc + no recommender | LOR generation | A (doc-type data) | Enter recommender |
| Visa evidence gate | `generation-context.ts` | Visa SOP + no visa evidence | Visa SOP generation | A (doc-type data) | Enter country/career evidence |
| Fact-sheet/basic-data gate | `generation-context.ts` | no usable facts at all | generation | A | Any meaningful profile data auto-approves |
| ~~Generate button disabled on intake readiness~~ | document `page.tsx` | intake sections incomplete | generation | **was C-made-A — FIXED this audit** | Advisory warning; server `GENERATION_BLOCKED` remains authority |
| `GENERATION_BLOCKED` 422 | document generate route | real minimum gates above | generation | A | Structured reasons + intake links shown |
| FINAL export approval | `document/export/route.ts:87` | no approvedVersionId | final download | D→A (consultant approves) | Approve a version |
| FINAL page limit | `export/route.ts:103` | rendered pages > limit | final PDF | A (requirement) | Edit down / raise limit |
| PREVIEW export | export route | — | — | none — always available | — |

## Generation pipeline

| Blocker | Location | Trigger | Blocks | Class | Recovery |
|---|---|---|---|---|---|
| Stage TECHNICAL failure | `stage-execution.ts` | timeout/429/5xx/network | stage | B | Bounded retry, checkpoint reuse, provider-response resume |
| Stage CONTENT (malformed) failure | `stage-contracts.ts` | contract-invalid output | stage | A after bounded content-regeneration | Retried with corrective prompt; fails loudly after bounds |
| `GENERATION_STATE_PERSISTENCE_FAILED` | pipeline:447 | DB write fails | run | A (integrity) | Halt recoverable — never silently continue |
| `CHECKPOINT_INTEGRITY_FAILED` | stage-execution:475 | checkpoint tamper/order | run | A (integrity) | New run |
| Orphaned RUNNING run | `generation-recovery.ts` | heartbeat >15s, no live proc | — | B | Auto-resume on status poll; same run, reuses responses |
| `GENERATION_ALREADY_IN_PROGRESS` | generate route | concurrent generate | duplicate run | A | Reconciles to live run (UI reloads, resumes progress) |
| Fact reviewer unavailable | `review-facts.ts` | provider failure | fact review | B | `PROVIDER_REQUEST_FAILED` → technical recovery |
| Fact review contract-invalid | stage-execution | after bounds | run | A | Documented technical failure |

## Intake readiness (post-fix)

`getProfileReadiness().canGenerate` = all 6 sections complete. After this audit it is **advisory only** — displayed as "For the strongest result, complete:" with links. The server's minimal gate (`generation-context.ts`) remains the authority: fact-sheet/basic-data + doc-type evidence (LOR recommender, visa evidence).
