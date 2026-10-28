"""Thin OpenAI HTTP client used only when OPENAI_API_KEY is set ("llm" mode).

Security rules:
- The API key is read from env only, sent solely in the Authorization header to
  the OpenAI endpoint, and never logged or returned.
- Response bodies are never logged (they can contain document contents).
- Every failure returns None / raises nothing: callers fall back to demo mode.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from . import config

logger = logging.getLogger("hireproof.llm")

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _headers() -> dict[str, str]:
    key = config.OPENAI_API_KEY
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _post_json(path: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """POST to the OpenAI-compatible API; return parsed JSON or None on any error."""
    url = f"{config.OPENAI_BASE_URL}{path}"
    try:
        with httpx.Client(timeout=config.OPENAI_TIMEOUT_SECONDS) as client:
            resp = client.post(url, headers=_headers(), json=payload)
    except Exception as exc:  # network/timeout/TLS — never propagate to the client
        logger.warning("openai request failed: %s", type(exc).__name__)
        return None
    if resp.status_code != 200:
        # Do not log the body: it may echo prompt contents (document text).
        logger.warning("openai request failed: status=%d", resp.status_code)
        return None
    try:
        data = resp.json()
    except Exception:
        logger.warning("openai response was not valid JSON")
        return None
    if not isinstance(data, dict):
        return None
    return data


def chat_json(system_prompt: str, user_prompt: str, *, max_tokens: int = 3000) -> dict[str, Any] | None:
    """Chat completion forced to JSON mode. Returns a dict, or None on any failure."""
    payload = {
        "model": config.OPENAI_CHAT_MODEL,
        "temperature": 0,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    data = _post_json("/chat/completions", payload)
    if data is None:
        return None
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        logger.warning("openai response missing choices[0].message.content")
        return None
    if not isinstance(content, str) or not content.strip():
        return None
    # Be tolerant of models that wrap JSON in code fences despite JSON mode.
    cleaned = _FENCE_RE.sub("", content.strip()).strip()
    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        logger.warning("model output was not parseable JSON (content not logged)")
        return None
    return parsed if isinstance(parsed, dict) else None


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    """Call the OpenAI embeddings endpoint; None on any failure (never fake vectors)."""
    payload = {"model": config.OPENAI_EMBEDDING_MODEL, "input": texts}
    data = _post_json("/embeddings", payload)
    if data is None:
        return None
    items = data.get("data")
    if not isinstance(items, list):
        logger.warning("embeddings response missing data[]")
        return None
    vectors: list[list[float]] = []
    try:
        for item in items:
            emb = item["embedding"]
            if not isinstance(emb, list) or not emb:
                return None
            vectors.append([float(x) for x in emb])
    except (KeyError, TypeError, ValueError):
        logger.warning("embeddings response had malformed vectors")
        return None
    if len(vectors) != len(texts):
        logger.warning("embeddings count mismatch: got=%d want=%d", len(vectors), len(texts))
        return None
    return vectors
