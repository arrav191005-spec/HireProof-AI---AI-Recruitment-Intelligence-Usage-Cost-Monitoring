"""Environment-driven configuration.

Security rules enforced here:
- Secrets (only OPENAI_API_KEY) are read from the environment and never logged,
  never returned by any endpoint, never written to files.
- Tunables have safe defaults so the service runs in "demo" mode with no config.
"""

from __future__ import annotations

import os

SERVICE_NAME = "hireproof-ai-documents"
SERVICE_VERSION = os.environ.get("SERVICE_VERSION", "1.0.0")

# Host is fixed to loopback: this service is called server-side by the Next.js
# app only; it must not be exposed on a public interface by default.
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8000"))

OPENAI_API_KEY: str | None = os.environ.get("OPENAI_API_KEY") or None
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
OPENAI_EMBEDDING_MODEL = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_TIMEOUT_SECONDS = float(os.environ.get("OPENAI_TIMEOUT_SECONDS", "60"))

# Resume size limits.
MAX_RESUME_SIZE_MB = float(os.environ.get("MAX_RESUME_SIZE_MB", "5"))


def max_resume_bytes() -> int:
    return int(MAX_RESUME_SIZE_MB * 1024 * 1024)


# Total extracted-text cap for a single resume (chars).
MAX_TEXT_CHARS = int(os.environ.get("MAX_TEXT_CHARS", "400000"))

# Request payload limits for /extract-evidence and /embed.
MAX_EXTRACT_TEXT_CHARS = int(os.environ.get("MAX_EXTRACT_TEXT_CHARS", str(MAX_TEXT_CHARS)))

# How much resume text we are willing to send to the LLM in one call (chars).
LLM_MAX_TEXT_CHARS = int(os.environ.get("LLM_MAX_TEXT_CHARS", "60000"))
MAX_EMBED_TEXTS = 256
MAX_EMBED_TEXT_CHARS = 20000


def ai_mode() -> str:
    """'llm' iff an OpenAI key is configured, otherwise deterministic 'demo' mode."""
    return "llm" if OPENAI_API_KEY else "demo"
