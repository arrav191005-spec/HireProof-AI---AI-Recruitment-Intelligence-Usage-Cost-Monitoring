"""Backend-only OpenAI Responses API abstraction.

Resume text and repository excerpts are untrusted data. Callers must provide
their own data-minimising prompt and validate every grounded reference after
the model returns. This module never falls back to fabricated output.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol, TypeVar

from pydantic import BaseModel

from . import config

T = TypeVar("T", bound=BaseModel)


class AIProviderError(Exception):
    """Sanitized provider error safe to map to an API response."""


class AIProviderDisabled(AIProviderError):
    pass


@dataclass(frozen=True)
class AIUsage:
    input_tokens: int
    output_tokens: int
    total_tokens: int
    estimated_cost_usd: float


@dataclass(frozen=True)
class AIResult:
    value: BaseModel
    model: str
    usage: AIUsage


class StructuredAIProvider(Protocol):
    def structured(self, *, system: str, user: str, schema: type[T],
                   schema_name: str, max_output_tokens: int = 4000) -> AIResult:
        """Return a Pydantic-validated structured result or raise AIProviderError."""


def _usage(response) -> AIUsage:
    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", input_tokens + output_tokens)
                       or input_tokens + output_tokens)
    cost = (
        input_tokens * config.OPENAI_INPUT_USD_PER_MILLION
        + output_tokens * config.OPENAI_OUTPUT_USD_PER_MILLION
    ) / 1_000_000
    return AIUsage(input_tokens, output_tokens, total_tokens, round(cost, 8))


class OpenAIResponsesProvider:
    """The real provider; imports the SDK lazily and never logs prompt bodies."""

    def __init__(self):
        if not config.ai_analysis_enabled():
            raise AIProviderDisabled("AI analysis is disabled or not configured.")
        if not 0 < config.AI_MAX_REQUEST_COST_USD <= 5:
            raise AIProviderDisabled("AI analysis request cost limit is not safely configured.")
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise AIProviderDisabled("OpenAI SDK is not installed.") from exc
        self.client = OpenAI(
            api_key=config.OPENAI_API_KEY,
            timeout=config.OPENAI_TIMEOUT_SECONDS,
            max_retries=max(0, min(config.OPENAI_MAX_RETRIES, 3)),
        )

    def structured(self, *, system: str, user: str, schema: type[T],
                   schema_name: str, max_output_tokens: int = 4000) -> AIResult:
        try:
            response = self.client.responses.create(
                model=config.OPENAI_RESUME_MODEL,
                instructions=system,
                input=user,
                max_output_tokens=max(256, min(max_output_tokens, 8000)),
                text={"format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "strict": True,
                    "schema": schema.model_json_schema(),
                }},
            )
            output = response.output_text
            if not isinstance(output, str) or not output.strip():
                raise ValueError("missing structured output")
            value = schema.model_validate_json(output)
            return AIResult(value=value, model=config.OPENAI_RESUME_MODEL, usage=_usage(response))
        except AIProviderError:
            raise
        except Exception as exc:
            # Do not include exception/provider body: either can reflect PII.
            raise AIProviderError("AI provider request failed.") from exc


class FixtureAIProvider:
    """Deterministic provider for tests; production code must not instantiate it."""

    def __init__(self, payload: dict, *, model: str = "fixture-model",
                 input_tokens: int = 12, output_tokens: int = 8):
        self.payload = payload
        self.model = model
        self.usage = AIUsage(input_tokens, output_tokens, input_tokens + output_tokens, 0.0)

    def structured(self, *, system: str, user: str, schema: type[T],
                   schema_name: str, max_output_tokens: int = 4000) -> AIResult:
        del system, user, schema_name, max_output_tokens
        return AIResult(value=schema.model_validate(self.payload), model=self.model, usage=self.usage)
