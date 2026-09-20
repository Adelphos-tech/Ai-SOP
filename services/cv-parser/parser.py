"""
Docling → ParsedDocument extraction.

Emits a structured intermediate representation — reading-order blocks
with layout labels, page numbers and bounding boxes. Semantic mapping
to the resume candidate is done in the Next.js layer
(cv-mapper-docling.ts); this service is document understanding only.
"""

import io
import tempfile
import time
from pathlib import Path

import docling

DOCLING_VERSION = getattr(docling, "__version__", "unknown")

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

# Text-native fast path: no OCR, table structure kept for row evidence
_FAST_OPTS = PdfPipelineOptions()
_FAST_OPTS.do_ocr = False
_FAST_OPTS.do_table_structure = True

_FAST_CONVERTER = DocumentConverter(
    allowed_formats=[InputFormat.PDF, InputFormat.DOCX],
    format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=_FAST_OPTS),
        # DOCX uses docling's default Word pipeline
    },
)

# OCR retry path — only when a PDF yields a near-empty text layer
_OCR_OPTS = PdfPipelineOptions()
_OCR_OPTS.do_ocr = True
_OCR_OPTS.do_table_structure = True

_OCR_CONVERTER = DocumentConverter(
    allowed_formats=[InputFormat.PDF],
    format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=_OCR_OPTS),
    },
)

# Below this many extracted chars, a PDF is probably scanned/image-only
_NEAR_EMPTY_TEXT = 10


def _convert(converter, data: bytes, filename: str):
    """Docling needs a path/stream; keep the file in a temp dir."""
    suffix = Path(filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        return converter.convert(tmp.name)


def _bbox(prov) -> list | None:
    try:
        b = prov.bbox
        return [b.l, b.t, b.r, b.b]
    except Exception:
        return None


def _blocks(doc) -> list:
    blocks = []
    order = 0
    for item, level in doc.iterate_items():
        label = str(getattr(item, "label", "text")).lower()
        text = (getattr(item, "text", "") or "").strip()
        provs = getattr(item, "prov", None) or []
        page = provs[0].page_no if provs else None
        bbox = _bbox(provs[0]) if provs else None

        if label == "table":
            # Keep table rows as individual text blocks so the mapper
            # sees them in reading order like any other line.
            try:
                md = item.export_to_markdown(doc)
            except Exception:
                md = ""
            for line in (md or "").splitlines():
                line = line.strip(" |")
                if line and not set(line) <= {"-", "|", " ", ":"}:
                    blocks.append({
                        "type": "table_row",
                        "text": line,
                        "page": page,
                        "order": order,
                        "bbox": bbox,
                        "level": level,
                    })
                    order += 1
            continue

        if not text:
            continue
        blocks.append({
            "type": label,  # text | section_header | title | list_item | caption | ...
            "text": text,
            "page": page,
            "order": order,
            "bbox": bbox,
            "level": level,
        })
        order += 1
    return blocks


def extract_document(data: bytes, filename: str) -> dict:
    ext = filename.lower().rsplit(".", 1)[-1]

    if ext == "txt":
        text = data.decode("utf-8", errors="replace")
        return {
            "pages": 1,
            "ocrUsed": False,
            "blocks": [
                {"type": "text", "text": ln.strip(), "page": 1, "order": i,
                 "bbox": None, "level": 0}
                for i, ln in enumerate(text.splitlines()) if ln.strip()
            ],
        }

    t0 = time.time()
    ocr_used = False

    conv = _convert(_FAST_CONVERTER, data, filename)
    blocks = _blocks(conv.document)

    # OCR retry — only for text-native-looking PDFs that came back empty
    if ext == "pdf" and sum(len(b["text"]) for b in blocks) <= _NEAR_EMPTY_TEXT:
        conv = _convert(_OCR_CONVERTER, data, filename)
        blocks = _blocks(conv.document)
        ocr_used = True

    if not blocks:
        raise ValueError(
            "No readable text found in document"
            + (" (scanned/image PDF — OCR produced nothing)" if ocr_used else "")
        )

    return {
        "pages": len(getattr(conv.document, "pages", {}) or {}),
        "ocrUsed": ocr_used,
        "durationMs": round((time.time() - t0) * 1000),
        "blocks": blocks,
    }
