"""Untrusted PDF handling for POST /parse-resume.

Threat model: PDFs are attacker-controlled data. We only ever *read bytes* out
of them (via pypdf text extraction); we never execute embedded JavaScript,
embedded files, formulas, or any other content. pypdf is a pure-Python parser
and does not run document code.

Error discipline: every failure raises HTTPException with a short, safe
"detail" string. Document content and stack traces never appear in responses;
we only log sizes and content hashes.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
from io import BytesIO

from fastapi import HTTPException
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from . import config
from .schemas import PageText, ParseResumeResponse

logger = logging.getLogger("hireproof.pdf")

SAFE_BAD_BASE64 = "Invalid base64 content for the uploaded file."
SAFE_UNREADABLE = "Unable to read PDF file. The file may be corrupted or not a valid PDF."
SAFE_ENCRYPTED = "This PDF is encrypted and cannot be processed."
SAFE_NO_TEXT = (
    "No extractable text found in this PDF (it may be a scanned document)."
)


def _decode_base64(content_base64: str) -> bytes:
    """Strict base64 decode. 422 on malformed input, 413 when over the size cap."""
    limit = config.max_resume_bytes()
    # For padded base64 of length L (multiple of 4): decoded length >= L/4*3 - 2.
    # So if L/4*3 - 2 > limit the decoded payload is *definitely* over the cap;
    # reject before decoding to bound memory usage.
    max_len = ((limit + 2) * 4) // 3 + 4
    if len(content_base64) > max_len:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {config.MAX_RESUME_SIZE_MB:g} MB.",
        )
    try:
        data = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail=SAFE_BAD_BASE64) from None
    if len(data) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {config.MAX_RESUME_SIZE_MB:g} MB.",
        )
    if not data:
        raise HTTPException(status_code=422, detail=SAFE_BAD_BASE64)
    return data


def _extract_pages(data: bytes) -> list[str]:
    """Extract raw per-page text. All failures map to safe 422 messages."""
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            # Try an empty password (common for "open-only" PDFs); anything else
            # is refused — we never attempt to crack documents.
            try:
                if not reader.decrypt(""):
                    raise HTTPException(status_code=422, detail=SAFE_ENCRYPTED)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=422, detail=SAFE_ENCRYPTED) from None
        pages: list[str] = []
        for page in reader.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                # A single broken page must not fail the whole document.
                pages.append("")
    except HTTPException:
        raise
    except (PdfReadError, ValueError, KeyError, IndexError, TypeError, OSError):
        raise HTTPException(status_code=422, detail=SAFE_UNREADABLE) from None
    except Exception:
        # Catch-all: pypdf can raise a wide variety of errors on hostile input.
        logger.exception("pypdf failed to parse a document (content not logged)")
        raise HTTPException(status_code=422, detail=SAFE_UNREADABLE) from None

    if not pages:
        raise HTTPException(status_code=422, detail=SAFE_UNREADABLE)
    return pages


def parse_resume(filename: str, mime_type: str, content_base64: str) -> ParseResumeResponse:
    # 1. Only PDFs are accepted.
    if mime_type.split(";")[0].strip().lower() != "application/pdf":
        raise HTTPException(
            status_code=415,
            detail="Unsupported media type. Only application/pdf resumes are accepted.",
        )

    # 2. Decode (413/422) and log only size + hash — never the bytes' content.
    data = _decode_base64(content_base64)
    digest = hashlib.sha256(data).hexdigest()[:16]
    logger.info(
        "parse-resume filename_len=%d bytes=%d sha256_16=%s",
        len(filename),
        len(data),
        digest,
    )

    # 3. Read the PDF.
    raw_pages = _extract_pages(data)

    # 4. Zero extractable text (scanned / image-only) is a 422, not a 500.
    if not any(p.strip() for p in raw_pages):
        raise HTTPException(status_code=422, detail=SAFE_NO_TEXT)

    # 5. Cap total text at MAX_TEXT_CHARS (400k default), truncating per page
    #    in order and flagging it so the caller can react.
    limit = config.MAX_TEXT_CHARS
    pages: list[PageText] = []
    used = 0
    truncated = False
    for i, raw in enumerate(raw_pages, start=1):
        remaining = limit - used
        if remaining <= 0:
            truncated = True
            text = ""
        elif len(raw) > remaining:
            truncated = True
            text = raw[:remaining]
            used += len(text)
        else:
            text = raw
            used += len(text)
        pages.append(PageText(page=i, text=text))

    full_text = "\n".join(p.text for p in pages)
    logger.info(
        "parse-resume done pages=%d chars=%d truncated=%s",
        len(pages),
        len(full_text),
        truncated,
    )
    return ParseResumeResponse(
        filename=filename,
        page_count=len(pages),
        pages=pages,
        full_text=full_text,
        total_chars=len(full_text),
        truncated=truncated,
    )
