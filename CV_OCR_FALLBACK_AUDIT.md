# CV OCR FALLBACK — ENGINE AUDIT + IMPLEMENTATION

## Engine evaluation

| Engine | Install burden | macOS/Linux | Integration | Verdict |
|---|---|---|---|---|
| **RapidOCR (sidecar)** | **Already installed** in the cv-parser venv (3.9.2, torch backend, bundled PP-OCR models) | both, pure pip/ONNX+torch | FastAPI endpoint on existing service | **SELECTED** |
| Tesseract | system binary + traineddata — NOT installed; extra prod dependency | needs apt/brew + tesserocr wrapper | subprocess or ctypes | rejected — new system dep |
| PaddleOCR | heavy paddle runtime, not installed | heavy | new service dep | rejected — install burden |
| tesseract.js (Node WASM) | npm only | both | Node-native | rejected — weaker quality, large WASM, slower than rapidocr |
| Docling built-in OCR | already in sidecar | both | already wired for PDF | **kept** — handles scanned PDFs inside `/parse` |

Docling's `/parse` already retries PDFs with `do_ocr=True` (OcrAutoOptions →
RapidOCR in this env) when the text layer is ≤10 chars — kept as-is; that
path surfaces `ocrUsed: true` provenance on the DOCLING_MAPPER candidate.

The new `POST /ocr` endpoint covers what docling cannot: **DOCX embedded
images** (docx has no OCR pipeline) and explicit raw-OCR extraction for
files that defeat the semantic layer.

## Trigger (deterministic, never spurious)

OCR runs **after** the normal strategy chain, only when:

- every strategy threw (no candidate), OR
- best candidate is UNREADABLE, OR
- best is EXTRACTION_ONLY with rawText < 40 chars

Never fires on PARTIAL_PARSE, never on real text, never for better
"structure" — text presence is the only criterion.

`OCR_NO_IMAGE_CONTENT` (sidecar couldn't find pages/images to OCR —
e.g. corrupt zip, zero-page pdf, docx with only tiny decorative media)
→ the ORIGINAL extraction error is preserved, not relabeled.

## DOCX image extraction

zipfile → `word/media/*`, ordered by `r:embed` refs in `document.xml`
(document order), decorative images skipped (`min side 150px`,
`min 8KB`). No macro/embedded-object execution — images only.

## PDF rendering

pypdfium2 rasterizes pages at ~180 DPI (`scale=2.5`), max 10 pages.

## Resource limits

`MAX_OCR_PAGES=10`, `MAX_OCR_PIXELS=20M` decoded, `MAX_OCR_SIDE=4000`
(downscale), `MAX_BYTES=10MB` upload cap, Node-side strategy timeout
`CV_OCR_TIMEOUT_MS` (default 240s). Limit breach → `CV_OCR_LIMIT_EXCEEDED`.

## Pipeline position

OCR produces `rawText` + line blocks → fed through the EXISTING
`parseCVText` semantic parser → normalized `ResumeParseCandidate`
(`OCR_TEXT_EXTRACTION` strategy id, `parserMeta.engine="rapidocr"`,
`ocrUsed=true`) → same plausibility diagnostics + ranking. No separate
schema, no privileged score, no auto-apply.

## Failure behavior

- OCR engine/service failure → `CV_OCR_EXTRACTION_FAILED` (stable code)
- Limit breach → `CV_OCR_LIMIT_EXCEEDED`
- No image content → original chain error preserved
- Weak structured parse of OCR text → EXTRACTION_ONLY/PARTIAL_PARSE
- `OCR_TEXT_RECOVERED` parse warning forces review state

## Measured corpus results

| File | Result | Text | Notes |
|---|---|---|---|
| Kunj image-only DOCX | PARSED_WITH_WARNINGS, OCR_TEXT_EXTRACTION | 4186 chars | 3 images OCR'd, contact 6/6, 3 plausible edu, 26 skills |
| synth-scanned.pdf | PARSED, DOCLING_MAPPER (ocrUsed) | 637 chars | docling-internal OCR path |
| Shivang DOCX | PARSED, MAMMOTH, no OCR | — | trigger did not fire |
| synth-singlecol.pdf | PARSED, DOCLING, no OCR | — | trigger did not fire |
| synth-table.docx | PARSED, MAMMOTH, no OCR | — | trigger did not fire |
| sparse.docx | EXTRACTION_ONLY, OCR attempted→NO_IMAGE_CONTENT | 38 chars | original winner preserved |
| corrupt.docx | CV_EXTRACTION_FAILED | — | original error, honest label |
| blank.pdf | CV_OCR_EXTRACTION_FAILED | — | pages existed, OCR ran, nothing |
