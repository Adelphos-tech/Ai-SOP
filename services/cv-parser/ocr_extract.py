"""
Free local OCR fallback — image-only / scanned resumes.

Engine: RapidOCR (PP-OCRv6, torch backend — already bundled in this venv).
No external binaries, no network calls, no AI APIs.

Scope per caller contract:
  - PDF   → rasterize pages with pypdfium2, OCR each page
  - DOCX  → unzip word/media/*, keep image order from document.xml rels,
            skip tiny decorative images, OCR each remaining image
  - image → OCR directly

Returns the SAME ParsedDocument block shape as parser.extract_document so
the Node layer can feed it through the existing mapping/ranking pipeline.
"""

import io
import re
import time
import zipfile

import pypdfium2 as pdfium
from PIL import Image

# ============================================================
# SAFETY LIMITS — one upload must never exhaust the server
# ============================================================
MAX_OCR_PAGES = 10          # PDF pages / DOCX images
MAX_OCR_PIXELS = 20_000_000 # ~4500x4500 decoded-image cap
MAX_OCR_SIDE = 4000         # downscale anything larger
MIN_IMAGE_SIDE = 150        # smaller than this is decorative (logo/icon)
MIN_IMAGE_BYTES = 8_000     # tiny embedded images are never page scans
RENDER_SCALE = 2.5          # ~180 DPI equivalent for pypdfium2
# Content-image thresholds mirror docx-image-inspect.ts — an image
# rendered at ≥500px short side AND ≥400k px plausibly carries
# document/page content; logos/photos fall far below.
CONTENT_IMAGE_MIN_SIDE = 500
CONTENT_IMAGE_MIN_PIXELS = 400_000

_OCR_ENGINE = None


def _engine():
    """Lazy singleton — first OCR call pays model init (~1-2s)."""
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        from rapidocr import RapidOCR
        from rapidocr.utils.typings import EngineType
        _OCR_ENGINE = RapidOCR(params={
            "Det.engine_type": EngineType.TORCH,
            "Cls.engine_type": EngineType.TORCH,
            "Rec.engine_type": EngineType.TORCH,
        })
    return _OCR_ENGINE


def _check_image(img: Image.Image) -> Image.Image:
    """Validate + bound decoded size. Raises ValueError on unsafe input."""
    w, h = img.size
    if w * h > MAX_OCR_PIXELS:
        raise ValueError("OCR_LIMIT_EXCEEDED: decoded image too large")
    if max(w, h) > MAX_OCR_SIDE:
        ratio = MAX_OCR_SIDE / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)))
    return img.convert("RGB")


def _ocr_image(img: Image.Image) -> list:
    """OCR one PIL image → list of text lines in reading order."""
    import numpy as np
    res = _engine()(np.asarray(img))
    if res is None or res.txts is None:
        return []
    return [t for t in res.txts if t and t.strip()]


def _lines_to_blocks(lines_by_page: list) -> list:
    blocks = []
    order = 0
    for page_no, lines in enumerate(lines_by_page, start=1):
        for ln in lines:
            blocks.append({
                "type": "text",
                "text": ln.strip(),
                "page": page_no,
                "order": order,
                "bbox": None,
                "level": 0,
            })
            order += 1
    return blocks


def _docx_images_in_order(data: bytes) -> list:
    """DOCX = zip; media files ordered by r:embed refs in document.xml."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = set(z.namelist())
        doc_xml = z.read("word/document.xml").decode("utf-8", "ignore")
        rels_xml = z.read("word/_rels/document.xml.rels").decode("utf-8", "ignore")

        rel_target = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels_xml))
        embeds = re.findall(r'r:embed="([^"]+)"', doc_xml)

        seen, ordered = set(), []
        for rid in embeds:
            target = rel_target.get(rid, "")
            name = "word/" + target if not target.startswith("word/") else target
            if name in names and name not in seen:
                seen.add(name)
                ordered.append(name)
        # media present but unreferenced in document order — append anyway
        for n in sorted(names):
            if n.startswith("word/media/") and n not in seen:
                ordered.append(n)

        out = []
        for name in ordered[:MAX_OCR_PAGES]:
            blob = z.read(name)
            if len(blob) < MIN_IMAGE_BYTES:
                continue
            try:
                img = Image.open(io.BytesIO(blob))
                img.load()
            except Exception:
                continue  # not a decodable image — skip safely
            w, h = img.size
            if min(w, h) < MIN_IMAGE_SIDE:
                continue  # decorative logo/icon
            out.append(img)
        return out


def inspect_pdf(data: bytes) -> dict:
    """Lightweight structural image inspection for PDF — NO OCR.

    Walks page objects and reports embedded image counts/sizes so the
    Node orchestrator can detect image-dominant PDFs (a thin text layer
    plus page-sized CV images that the text path silently drops).
    Rendered pixel size is used, not intrinsic bitmap size — an image
    displayed small is decorative even if the source bitmap is huge.
    """
    image_type = getattr(getattr(pdfium, "raw", pdfium), "FPDF_PAGEOBJ_IMAGE", 3)
    try:
        doc = pdfium.PdfDocument(data)
    except Exception:
        raise ValueError("INSPECT_UNREADABLE")
    try:
        image_count = 0
        content_images = 0
        content_pixels = 0
        for i in range(len(doc)):
            try:
                # max_depth descends into Form XObjects so images inside
                # content streams/forms are still counted
                objs = doc[i].get_objects(max_depth=3)
            except TypeError:
                objs = doc[i].get_objects()
            except Exception:
                continue
            for o in objs:
                if o.type != image_type:
                    continue
                image_count += 1
                try:
                    w, h = o.get_px_size()
                except Exception:
                    continue
                if min(w, h) >= CONTENT_IMAGE_MIN_SIDE and w * h >= CONTENT_IMAGE_MIN_PIXELS:
                    content_images += 1
                    content_pixels += int(w) * int(h)
        return {
            "pages": len(doc),
            "imageCount": image_count,
            "contentImageCount": content_images,
            "contentImagePixels": content_pixels,
        }
    finally:
        doc.close()


def ocr_document(data: bytes, filename: str) -> dict:
    """OCR extraction → ParsedDocument-shaped dict. Raises ValueError
    on non-image/unsafe input, RuntimeError on engine failure."""
    t0 = time.time()
    ext = filename.lower().rsplit(".", 1)[-1]
    lines_by_page: list = []
    image_count = 0

    if ext == "pdf":
        try:
            doc = pdfium.PdfDocument(data)
        except Exception:
            raise ValueError("OCR_NO_IMAGE_CONTENT")
        try:
            n = min(len(doc), MAX_OCR_PAGES)
            if n == 0:
                raise ValueError("OCR_NO_IMAGE_CONTENT")
            for i in range(n):
                img = doc[i].render(scale=RENDER_SCALE).to_pil()
                image_count += 1
                lines_by_page.append(_ocr_image(_check_image(img)))
        finally:
            doc.close()
    elif ext == "docx":
        try:
            images = _docx_images_in_order(data)
        except zipfile.BadZipFile:
            raise ValueError("OCR_NO_IMAGE_CONTENT")
        if not images:
            raise ValueError("OCR_NO_IMAGE_CONTENT")
        image_count = len(images)
        for img in images:
            lines_by_page.append(_ocr_image(_check_image(img)))
    elif ext in ("png", "jpg", "jpeg", "tiff", "bmp", "webp"):
        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception:
            raise ValueError("OCR_NO_IMAGE_CONTENT")
        image_count = 1
        lines_by_page.append(_ocr_image(_check_image(img)))
    else:
        raise ValueError("OCR_NO_IMAGE_CONTENT")

    blocks = _lines_to_blocks(lines_by_page)
    total = sum(len(b["text"]) for b in blocks)
    if total == 0:
        raise ValueError("No readable text recovered by OCR")

    return {
        "pages": len(lines_by_page),
        "ocrUsed": True,
        "engine": "rapidocr",
        "imageCount": image_count,
        "durationMs": round((time.time() - t0) * 1000),
        "blocks": blocks,
    }
