"""Feature-gated, scoped GitHub verification APIs."""
import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from ..auth import Identity, require_identity
from ..github_verification import normalize_repository_url
from ..scoped_db import scoped_read

router = APIRouter(prefix="/api/v2", tags=["project verification"])
Technology = Literal["JavaScript", "TypeScript", "React", "Python", "FastAPI",
                     "PostgreSQL", "Java", "Spring Boot"]


def require_enabled():
    if os.environ.get("VERIFICATION_ENABLED") != "true":
        raise HTTPException(status_code=503, detail="Verification is disabled.")


def quota_retry_after(exc: DBAPIError) -> str | None:
    """Map the database quota exception to a sanitized 429 response."""
    orig = exc.orig
    sqlstate = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    if sqlstate != "P0001" or "quota" not in str(orig).lower():
        return None
    detail = getattr(getattr(orig, "diag", None), "message_detail", None)
    return {"active": "60", "hourly": "3600", "daily": "86400"}.get(detail, "3600")


class VerificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    repository_url: str = Field(min_length=1, max_length=230)
    claims: list[Technology] = Field(min_length=1, max_length=8)


class RunQueued(BaseModel):
    run_id: str
    status: str


class Evidence(BaseModel):
    id: str
    claim: str
    status: str
    explanation: str
    source_url: str | None
    file_path: str | None
    commit_sha: str | None


class VerificationReport(BaseModel):
    id: str
    project_id: int
    project_name: str | None
    repository_url: str
    status: str
    commit_sha: str | None
    error_code: str | None
    requested_at: str
    finished_at: str | None
    evidence: list[Evidence]


def _owned_project(conn, project_id):
    exists = conn.execute(text("""
        select exists(select 1 from projects p join candidate_owners o on o.candidate_id=p.candidate_id
                      where p.id=:pid and o.user_id=hp_user_id())
    """), {"pid": project_id}).scalar_one()
    if not exists:
        raise HTTPException(status_code=404, detail="Project not found.")


def _report(conn, project_id, run_id=None):
    row = conn.execute(text("""
        select r.id,r.project_id,p.name as project_name,ref.repository_url,r.status,r.commit_sha,r.error_code,
               r.requested_at,r.finished_at
        from project_verification_runs r
        join project_repository_refs ref on ref.id=r.repository_ref_id
        join projects p on p.id=r.project_id
        where r.project_id=:pid and (cast(:rid as text) is null or r.id=:rid)
        order by r.requested_at desc,r.id desc limit 1
    """), {"pid": project_id, "rid": run_id}).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Verification not found.")
    evidence = conn.execute(text("""
        select e.id,c.claim_text as claim,e.status,e.explanation,e.source_url,e.file_path,e.commit_sha
        from project_verification_evidence e join project_claims c on c.id=e.claim_id
        where e.run_id=:rid order by e.id
    """), {"rid": row["id"]}).mappings()
    result = dict(row)
    result["requested_at"] = row["requested_at"].isoformat()
    result["finished_at"] = row["finished_at"].isoformat() if row["finished_at"] else None
    result["evidence"] = [dict(item) for item in evidence]
    return result


@router.post("/candidates/me/projects/{project_id}/verify", response_model=RunQueued, status_code=202)
@router.post("/candidates/me/projects/{project_id}/reverify", response_model=RunQueued, status_code=202)
def request_verification(project_id: int, body: VerificationRequest, identity: Identity = Depends(require_identity)):
    require_enabled()
    try:
        _, _, url = normalize_repository_url(body.repository_url)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid GitHub repository URL.") from None
    def enqueue(conn):
        _owned_project(conn, project_id)
        try:
            run_id = conn.execute(text("select hp_enqueue_verification(:pid,:url,:claims)"),
                                  {"pid": project_id, "url": url, "claims": body.claims}).scalar_one()
        except DBAPIError as exc:
            retry_after = quota_retry_after(exc)
            if retry_after is None:
                raise
            raise HTTPException(
                status_code=429,
                detail="Verification request limit reached. Try again later.",
                headers={"Retry-After": retry_after},
            ) from None
        if run_id == "conflict":
            raise HTTPException(status_code=409, detail="A different verification is already active.")
        if run_id is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        status = conn.execute(text("select status from project_verification_runs where id=:id"), {"id": run_id}).scalar_one()
        return {"run_id": run_id, "status": status}
    return scoped_read(identity.subject, enqueue)


@router.get("/candidates/me/projects/{project_id}/verification", response_model=VerificationReport)
def latest_verification(project_id: int, identity: Identity = Depends(require_identity)):
    require_enabled()
    def query(conn):
        _owned_project(conn, project_id)
        return _report(conn, project_id)
    return scoped_read(identity.subject, query)


@router.get("/candidates/me/projects/{project_id}/verification/{run_id}", response_model=VerificationReport)
def candidate_verification(project_id: int, run_id: str, identity: Identity = Depends(require_identity)):
    require_enabled()
    def query(conn):
        _owned_project(conn, project_id)
        return _report(conn, project_id, run_id)
    return scoped_read(identity.subject, query)


@router.get("/candidates/me/projects/{project_id}/verification/{run_id}/evidence/{evidence_id}", response_model=Evidence)
def candidate_evidence(project_id: int, run_id: str, evidence_id: str,
                       identity: Identity = Depends(require_identity)):
    require_enabled()
    def query(conn):
        _owned_project(conn, project_id)
        report = _report(conn, project_id, run_id)
        match = next((item for item in report["evidence"] if item["id"] == evidence_id), None)
        if match is None:
            raise HTTPException(status_code=404, detail="Evidence not found.")
        return match
    return scoped_read(identity.subject, query)


@router.get("/recruiter/workspaces/{workspace_id}/applications/{application_id}/projects/{project_id}/verification/{run_id}",
            response_model=VerificationReport)
def recruiter_verification(workspace_id: str, application_id: str, project_id: int, run_id: str,
                           identity: Identity = Depends(require_identity)):
    require_enabled()
    def query(conn):
        allowed = conn.execute(text("""
            select exists(select 1 from applications a
              join workspace_jobs w on w.job_id=a.job_id
              join projects p on p.candidate_id=a.candidate_id
              where a.id=:aid and w.workspace_id=:wid and p.id=:pid and hp_in_workspace(:wid))
        """), {"aid": application_id, "wid": workspace_id, "pid": project_id}).scalar_one()
        if not allowed:
            raise HTTPException(status_code=404, detail="Verification not found.")
        return _report(conn, project_id, run_id)
    return scoped_read(identity.subject, query)
