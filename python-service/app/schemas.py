"""Pydantic request/response models for every endpoint.

Errors returned by the API are always {"detail": "..."} JSON produced by the
exception handlers in app.main — never raw validation echoes of untrusted
document contents, never stack traces.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


# --------------------------------------------------------------------------- #
# /parse-resume
# --------------------------------------------------------------------------- #
class ParseResumeRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    mime_type: str = Field(min_length=1, max_length=128)
    content_base64: str = Field(min_length=1)

    @field_validator("filename", "mime_type")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


class PageText(BaseModel):
    page: int = Field(ge=1)
    text: str


class ParseResumeResponse(BaseModel):
    filename: str
    page_count: int
    pages: list[PageText]
    full_text: str
    total_chars: int
    truncated: bool = False


# --------------------------------------------------------------------------- #
# /extract-evidence
# --------------------------------------------------------------------------- #
class ExtractEvidenceRequest(BaseModel):
    filename: str | None = Field(default=None, max_length=512)
    text: str = Field(min_length=1)
    pages: list[PageText] | None = None

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be blank")
        return v


class SkillItem(BaseModel):
    skill: str
    years: float | None = None
    level: str | None = None
    excerpt: str
    page: int | None = None


class ExperienceItem(BaseModel):
    company: str | None = None
    title: str | None = None
    start: str | None = None
    end: str | None = None
    summary: str | None = None
    page: int | None = None


class EducationItem(BaseModel):
    institution: str | None = None
    degree: str | None = None
    start: str | None = None
    end: str | None = None
    page: int | None = None


class ProjectItem(BaseModel):
    name: str
    summary: str | None = None
    tech: list[str] = Field(default_factory=list)
    page: int | None = None


class EvidenceItem(BaseModel):
    skill: str
    excerpt: str
    page: int | None = None
    section: str | None = None
    status: Literal["claimed"] = "claimed"


class ExtractEvidenceResponse(BaseModel):
    mode: Literal["demo", "llm"]
    mode_label: str
    name: str | None = None
    email: str | None = None
    headline: str | None = None
    location: str | None = None
    years_experience: float | None = None
    summary: str | None = None
    skills: list[SkillItem] = Field(default_factory=list)
    experience: list[ExperienceItem] = Field(default_factory=list)
    education: list[EducationItem] = Field(default_factory=list)
    projects: list[ProjectItem] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# /embed
# --------------------------------------------------------------------------- #
class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=256)

    @field_validator("texts")
    @classmethod
    def _texts_not_blank(cls, v: list[str]) -> list[str]:
        for i, t in enumerate(v):
            if not t.strip():
                raise ValueError(f"texts[{i}] must not be blank")
        return v


class EmbedResponse(BaseModel):
    enabled: bool
    model: str | None = None
    vectors: list[list[float]] | None = None


# --------------------------------------------------------------------------- #
# /generate-interview-questions
# --------------------------------------------------------------------------- #
class Requirement(BaseModel):
    skill: str = Field(min_length=1, max_length=200)
    category: Literal["required", "preferred"] | None = None

    @field_validator("skill")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("skill must not be blank")
        return v


class GenerateQuestionsRequest(BaseModel):
    requirement: Requirement
    evidence_excerpts: list[str] = Field(default_factory=list, max_length=50)
    count: int = Field(default=3, ge=1, le=5)


class QuestionItem(BaseModel):
    text: str
    grounded_in: str | None = None


class GenerateQuestionsResponse(BaseModel):
    mode: Literal["demo", "llm"]
    mode_label: str
    questions: list[QuestionItem]


# --------------------------------------------------------------------------- #
# /health
# --------------------------------------------------------------------------- #
class ModelsInfo(BaseModel):
    chat: str
    embedding: str


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    pdf_library: str
    ai_mode: Literal["demo", "llm"]
    models: ModelsInfo
