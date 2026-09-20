"""
D-Vivid CV Parser Service — internal Docling extraction layer.

INTERNAL ONLY — bind to 127.0.0.1/private interface. Next.js is the
authenticated public entry point; this service performs document
understanding only and never writes to the canonical profile.

Endpoints:
  GET  /health  → service + docling version
  POST /parse   → multipart file upload → ParsedDocument JSON
"""

import hashlib
import os
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from parser import extract_document, DOCLING_VERSION

app = FastAPI(title="dvivid-cv-parser", docs_url=None, redoc_url=None)

MAX_BYTES = 10 * 1024 * 1024  # mirror app upload cap
ALLOWED_EXT = {".pdf", ".docx", ".txt"}
PARSE_TIMEOUT_S = int(os.environ.get("CV_PARSER_TIMEOUT", "120"))


@app.get("/health")
def health():
    return {
        "status": "ok",
        "engine": "docling",
        "doclingVersion": DOCLING_VERSION,
        "time": time.time(),
    }


@app.post("/parse")
async def parse(file: UploadFile = File(...)):
    if not file or not file.filename:
        raise HTTPException(400, "No file provided")

    ext = "." + file.filename.lower().rsplit(".", 1)[-1]
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large (max 10 MB)")

    try:
        result = extract_document(data, file.filename)
    except ValueError as e:
        # deterministic client-facing failures (unsupported/corrupt)
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001 — never leak internals
        raise HTTPException(500, f"Extraction failed: {type(e).__name__}")

    return JSONResponse(
        {
            "success": True,
            "engine": "docling",
            "doclingVersion": DOCLING_VERSION,
            "sourceHash": hashlib.sha256(data).hexdigest(),
            **result,
        }
    )
