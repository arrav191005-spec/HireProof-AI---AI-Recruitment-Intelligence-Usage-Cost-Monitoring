"""FastAPI application: routes + exception handlers.

Error discipline: every error response is JSON {"detail": "..."} with the right
status code. Tracebacks are logged server-side only; responses never contain
stack traces, resume contents, or secrets. Access logs contain paths only.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__, config, questions as questions_mod
from .extraction import extract_evidence
from .llm import embed_texts
from .pdf import parse_resume
from .schemas import (
    EmbedRequest,
    EmbedResponse,
    ExtractEvidenceRequest,
    ExtractEvidenceResponse,
    GenerateQuestionsRequest,
    GenerateQuestionsResponse,
    HealthResponse,
    ModelsInfo,
    ParseResumeRequest,
    ParseResumeResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("hireproof.main")

app = FastAPI(
    title="HireProof AI — Document Service",
    description=(
        "PDF resume parsing and grounded evidence extraction. "
        "Documents are untrusted data: they are only ever read as text, never executed."
    ),
    version=config.SERVICE_VERSION,
    docs_url="/docs",
    openapi_url="/openapi.json",
)


# --------------------------------------------------------------------------- #
# Exception handlers -> always {"detail": ...} JSON, never tracebacks/details
# --------------------------------------------------------------------------- #
@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse(status_code=exc.status_code, content={"detail": detail})


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request, exc: RequestValidationError) -> JSONResponse:
    # Return field locations + messages, but NEVER the rejected input values
    # (they may contain document contents).
    errors = [
        {
            "loc": [str(part) for part in err.get("loc", ()) if part != "body"],
            "msg": str(err.get("msg", "invalid value")),
        }
        for err in exc.errors()[:10]
    ]
    return JSONResponse(
        status_code=422,
        content={"detail": "Request validation failed.", "errors": errors},
    )


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request, exc: Exception) -> JSONResponse:
    # Traceback goes to the server log only — never to the client.
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=config.SERVICE_NAME,
        version=config.SERVICE_VERSION,
        pdf_library="pypdf",
        ai_mode=config.ai_mode(),  # "llm" iff OPENAI_API_KEY is set, else "demo"
        models=ModelsInfo(
            chat=config.OPENAI_CHAT_MODEL,
            embedding=config.OPENAI_EMBEDDING_MODEL,
        ),
    )


@app.post("/parse-resume", response_model=ParseResumeResponse)
def parse_resume_route(body: ParseResumeRequest) -> ParseResumeResponse:
    """Parse an untrusted PDF resume into per-page text (415/413/422 on failure)."""
    return parse_resume(body.filename, body.mime_type, body.content_base64)


@app.post("/extract-evidence", response_model=ExtractEvidenceResponse)
def extract_evidence_route(body: ExtractEvidenceRequest) -> ExtractEvidenceResponse:
    if len(body.text) > config.MAX_EXTRACT_TEXT_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Text exceeds the maximum allowed size of {config.MAX_EXTRACT_TEXT_CHARS} characters.",
        )
    if body.pages is not None and len(body.pages) > 1000:
        raise HTTPException(status_code=422, detail="Too many pages in the request.")
    return extract_evidence(body)


@app.post("/embed", response_model=EmbedResponse)
def embed_route(body: EmbedRequest) -> EmbedResponse:
    for i, text in enumerate(body.texts):
        if len(text) > config.MAX_EMBED_TEXT_CHARS:
            raise HTTPException(
                status_code=422,
                detail=f"texts[{i}] exceeds the maximum length of {config.MAX_EMBED_TEXT_CHARS} characters.",
            )
    if not config.OPENAI_API_KEY:
        # Honest fallback: no key configured -> no vectors. Never fake vectors.
        return EmbedResponse(enabled=False, model=None, vectors=None)
    vectors = embed_texts(body.texts)
    if vectors is None:
        raise HTTPException(status_code=502, detail="Embedding provider request failed.")
    return EmbedResponse(enabled=True, model=config.OPENAI_EMBEDDING_MODEL, vectors=vectors)


@app.post("/generate-interview-questions", response_model=GenerateQuestionsResponse)
def generate_questions_route(body: GenerateQuestionsRequest) -> GenerateQuestionsResponse:
    return questions_mod.generate_questions(body)
