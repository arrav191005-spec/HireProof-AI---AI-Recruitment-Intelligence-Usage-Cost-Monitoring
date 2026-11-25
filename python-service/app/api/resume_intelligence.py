"""Consented, scoped resume intelligence APIs.

AI output is advisory. Every claim is grounded to resume text and mapped only
to already stored commit-pinned repository evidence.
"""
from __future__ import annotations

import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from ..ai_provider import AIProviderDisabled, AIProviderError, OpenAIResponsesProvider
from .. import config
from ..auth import Identity, require_identity
from ..resume_intelligence import (
    ATSReport, ClaimEvidence, ResumeIntelligenceOutput, analyze_resume_text,
    ats_compatibility, map_claims_to_evidence,
)
from ..scoped_db import scoped_read

router = APIRouter(prefix="/api/v2", tags=["resume intelligence"])


class ResumeAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resume_id: str = Field(min_length=1, max_length=160)
    consent_to_external_ai: bool
    job_id: str | None = Field(default=None, min_length=1, max_length=160)


class ResumeAnalysisResponse(BaseModel):
    run_id: str
    status: str
    model_identifier: str | None = None
    result: ResumeIntelligenceOutput | None = None
    claims: list[ClaimEvidence] = Field(default_factory=list)
    ats: ATSReport | None = None


class ResumeRecord(BaseModel):
    id: str
    filename: str | None
    uploaded_at: str
    status: str


def get_ai_provider():
    """Dependency seam for deterministic fixture tests; never use fixtures in runtime."""
    return OpenAIResponsesProvider()


def ai_quota_retry_after(exc) -> str | None:
    orig = getattr(exc, "orig", exc)
    sqlstate = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    if sqlstate != "P0001" or "quota" not in str(orig).lower():
        return None
    detail = getattr(getattr(orig, "diag", None), "message_detail", None)
    return {"hourly": "3600", "daily": "86400", "cost": "86400"}.get(detail, "3600")


def _candidate(conn):
    row = conn.execute(text("""
        select c.id from candidates c join candidate_owners o on o.candidate_id=c.id
        where o.user_id=hp_user_id()
    """)).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Candidate profile not found.")
    return row["id"]


def _resume_and_context(conn, candidate_id: str, resume_id: str, job_id: str | None):
    resume = conn.execute(text("""
        select id, full_text, sections from resumes
        where id=:rid and candidate_id=:cid
    """), {"rid": resume_id, "cid": candidate_id}).mappings().first()
    if resume is None or not resume["full_text"]:
        raise HTTPException(status_code=404, detail="Resume text not found.")
    projects = conn.execute(text("""
        select id,name,url,summary,tech from projects where candidate_id=:cid order by id
    """), {"cid": candidate_id}).mappings().all()
    requirements = []
    if job_id:
        allowed = conn.execute(text("""
            select exists(select 1 from applications where candidate_id=:cid and job_id=:jid)
        """), {"cid": candidate_id, "jid": job_id}).scalar_one()
        if not allowed:
            raise HTTPException(status_code=404, detail="Job not found.")
        requirements = [dict(item) for item in conn.execute(text("""
            select skill,category,min_years from job_requirements where job_id=:jid order by id
        """), {"jid": job_id}).mappings()]
    evidence = [dict(item) for item in conn.execute(text("""
        select c.claim_text as claim,e.status,e.file_path,e.source_url,e.source_excerpt,e.explanation
        from project_verification_evidence e
        join project_claims c on c.id=e.claim_id
        join project_verification_runs r on r.id=e.run_id and r.status='completed'
        join projects p on p.id=e.project_id
        where p.candidate_id=:cid
    """), {"cid": candidate_id}).mappings()]
    skill_rows = conn.execute(text("select skill from candidate_skills where candidate_id=:cid"),
                              {"cid": candidate_id}).scalars().all()
    experience = conn.execute(text("select exists(select 1 from experiences where candidate_id=:cid)"),
                              {"cid": candidate_id}).scalar_one()
    education = conn.execute(text("select exists(select 1 from education where candidate_id=:cid)"),
                             {"cid": candidate_id}).scalar_one()
    return dict(resume), [dict(item) for item in projects], requirements, evidence, list(skill_rows), experience, education


def _page_for_excerpt(sections, excerpt: str) -> int | None:
    if not isinstance(sections, list):
        return None
    for section in sections:
        if isinstance(section, dict) and isinstance(section.get("text"), str) and excerpt in section["text"]:
            page = section.get("page")
            return page if isinstance(page, int) and page > 0 else None
    return None


@router.get("/candidates/me/resumes", response_model=list[ResumeRecord])
def my_resumes(identity: Identity = Depends(require_identity)):
    def query(conn):
        candidate_id = _candidate(conn)
        rows = conn.execute(text("""
            select id,filename,uploaded_at,status from resumes
            where candidate_id=:cid order by uploaded_at desc,id desc
        """), {"cid": candidate_id}).mappings()
        return [ResumeRecord(id=row["id"], filename=row["filename"], status=row["status"],
                             uploaded_at=row["uploaded_at"].isoformat()) for row in rows]
    return scoped_read(identity.subject, query)


@router.post("/candidates/me/resume-intelligence", response_model=ResumeAnalysisResponse)
def analyze_my_resume(body: ResumeAnalysisRequest, identity: Identity = Depends(require_identity)):
    if not body.consent_to_external_ai:
        raise HTTPException(status_code=422, detail="Explicit consent is required before sending resume text to an AI provider.")
    try:
        provider = get_ai_provider()
    except AIProviderDisabled:
        raise HTTPException(status_code=503, detail="AI analysis is disabled or not configured.") from None

    run_id = "rai-" + uuid4().hex
    def start(conn):
        candidate_id = _candidate(conn)
        context = _resume_and_context(conn, candidate_id, body.resume_id, body.job_id)
        try:
            created = conn.execute(text("""
                select hp_start_ai_analysis_run(:id,:resume,cast(:reserve as numeric))
            """), {"id": run_id, "resume": body.resume_id,
                   "reserve": config.AI_MAX_REQUEST_COST_USD}).scalar_one()
        except Exception as exc:
            retry_after = ai_quota_retry_after(exc)
            if retry_after is None:
                raise
            raise HTTPException(status_code=429,
                                detail="AI analysis request limit reached. Try again later.",
                                headers={"Retry-After": retry_after}) from None
        if created is None:
            raise HTTPException(status_code=404, detail="Resume not found.")
        return candidate_id, context
    candidate_id, context = scoped_read(identity.subject, start)
    resume, projects, requirements, evidence, existing_skills, has_experience, has_education = context
    try:
        result, provider_result = analyze_resume_text(resume["full_text"], provider)
        mapped = map_claims_to_evidence(result.claims, evidence)
        skills = list(dict.fromkeys([*existing_skills, *result.skills]))
        ats = ats_compatibility(requirements=requirements, skills=skills, projects=result.projects,
                                has_experience=has_experience, has_education=has_education) if body.job_id else None
    except (AIProviderError, ValueError):
        def fail(conn):
            _candidate(conn)
            conn.execute(text("""
                update resume_ai_analysis_runs set status='failed',error_code='provider_unavailable',finished_at=now()
                where id=:id and candidate_id=:cid
            """), {"id": run_id, "cid": candidate_id})
        scoped_read(identity.subject, fail)
        raise HTTPException(status_code=502, detail="AI provider request failed; no analysis was fabricated.") from None

    def persist(conn):
        _candidate(conn)
        conn.execute(text("""
            update resume_ai_analysis_runs
            set status='completed',model_identifier=:model,resume_summary=:summary,report=cast(:report as jsonb),finished_at=now()
            where id=:id and candidate_id=:cid
        """), {"id": run_id, "cid": candidate_id, "model": provider_result.model,
               "summary": result.summary, "report": json.dumps(result.model_dump(mode="json"))})
        conn.execute(text("""
            insert into ai_request_usage(id,analysis_run_id,provider,model_identifier,input_tokens,output_tokens,total_tokens,estimated_cost_usd)
            values (:id,:run,'openai',:model,:input,:output,:total,:cost)
        """), {"id": "aiu-" + uuid4().hex, "run": run_id, "model": provider_result.model,
               "input": provider_result.usage.input_tokens, "output": provider_result.usage.output_tokens,
               "total": provider_result.usage.total_tokens, "cost": provider_result.usage.estimated_cost_usd})
        project_ids = {str(row["name"]).casefold(): row["id"] for row in projects if row["name"]}
        urls = {str(row["name"]).casefold(): row["url"] for row in projects if row["name"]}
        claim_by_text = {item.claim_text: item for item in result.claims}
        for mapped_item in mapped:
            claim = claim_by_text[mapped_item.claim_text]
            project_name = claim.project_name
            matching_project = next((project for project in result.projects
                                     if project.name.casefold() == project_name.casefold()), None)
            refs = [] if not mapped_item.source_url else [{
                "source_url": mapped_item.source_url, "file_path": mapped_item.file_path,
                "source_excerpt": mapped_item.source_excerpt,
            }]
            conn.execute(text("""
                insert into resume_project_claims(
                  id,analysis_run_id,candidate_id,resume_id,project_id,project_name,claim_text,claim_category,
                  source_excerpt,source_page,github_url,deployed_url,evidence_classification,evidence_refs,explanation,limitations
                ) values (
                  :id,:run,:candidate,:resume,:project,:project_name,:claim,:category,
                  :excerpt,:page,:github,:deployed,:classification,cast(:refs as jsonb),:explanation,:limitations
                )
            """), {
                "id": "rpc-" + uuid4().hex, "run": run_id, "candidate": candidate_id,
                "resume": body.resume_id, "project": project_ids.get(project_name.casefold()),
                "project_name": project_name, "claim": claim.claim_text, "category": claim.category,
                "excerpt": claim.source_excerpt, "page": _page_for_excerpt(resume["sections"], claim.source_excerpt),
                "github": matching_project.github_url if matching_project else urls.get(project_name.casefold()),
                "deployed": matching_project.deployed_url if matching_project else None,
                "classification": mapped_item.classification, "refs": json.dumps(refs),
                "explanation": mapped_item.explanation, "limitations": mapped_item.limitations,
            })
        if ats:
            conn.execute(text("""
                insert into job_compatibility_runs(id,analysis_run_id,candidate_id,job_id,status,estimate,report)
                values (:id,:run,:candidate,:job,'completed',:estimate,cast(:report as jsonb))
            """), {"id": "jcr-" + uuid4().hex, "run": run_id, "candidate": candidate_id,
                   "job": body.job_id, "estimate": ats.estimate, "report": json.dumps(ats.model_dump(mode="json"))})
    scoped_read(identity.subject, persist)
    return ResumeAnalysisResponse(run_id=run_id, status="completed", model_identifier=provider_result.model,
                                  result=result, claims=mapped, ats=ats)


@router.get("/candidates/me/resume-intelligence/{run_id}", response_model=ResumeAnalysisResponse)
def get_my_resume_analysis(run_id: str, identity: Identity = Depends(require_identity)):
    def query(conn):
        candidate_id = _candidate(conn)
        row = conn.execute(text("""
            select id,status,model_identifier,report from resume_ai_analysis_runs
            where id=:id and candidate_id=:cid
        """), {"id": run_id, "cid": candidate_id}).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Analysis not found.")
        report = row["report"] or {}
        output = ResumeIntelligenceOutput.model_validate(report) if row["status"] == "completed" else None
        claims = [ClaimEvidence(
            claim_text=item["claim_text"], classification=item["evidence_classification"],
            file_path=(item["evidence_refs"][0].get("file_path") if item["evidence_refs"] else None),
            source_url=(item["evidence_refs"][0].get("source_url") if item["evidence_refs"] else None),
            source_excerpt=(item["evidence_refs"][0].get("source_excerpt") if item["evidence_refs"] else None),
            explanation=item["explanation"], limitations=item["limitations"],
        ) for item in conn.execute(text("""
            select claim_text,evidence_classification,evidence_refs,explanation,limitations
            from resume_project_claims where analysis_run_id=:id order by created_at,id
        """), {"id": run_id}).mappings()]
        return ResumeAnalysisResponse(run_id=row["id"], status=row["status"], model_identifier=row["model_identifier"],
                                      result=output, claims=claims)
    return scoped_read(identity.subject, query)
