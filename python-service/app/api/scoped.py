"""Read-only private API. Writes and verification execution remain disabled."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from ..auth import Identity, require_identity
from ..scoped_db import scoped_read

router = APIRouter(prefix="/api/v2", tags=["scoped reads"])


class CandidateProfile(BaseModel):
    id: str
    full_name: str


class CandidateProject(BaseModel):
    id: int
    name: str | None


class Workspace(BaseModel):
    id: str
    name: str


class WorkspaceJob(BaseModel):
    id: str
    title: str


def own_candidate(conn):
    row = conn.execute(text("""
        select c.id, c.full_name from candidates c
        join candidate_owners o on o.candidate_id = c.id
        where o.user_id = hp_user_id()
    """)).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Candidate profile not found.")
    return dict(row)


@router.get("/candidates/me", response_model=CandidateProfile)
def candidate_me(identity: Identity = Depends(require_identity)):
    return scoped_read(identity.subject, own_candidate)


@router.get("/candidates/me/projects", response_model=list[CandidateProject])
def candidate_projects(identity: Identity = Depends(require_identity)):
    def query(conn):
        candidate = own_candidate(conn)
        return [dict(row) for row in conn.execute(text(
            "select id, name from projects where candidate_id=:candidate order by id"
        ), {"candidate": candidate["id"]}).mappings()]
    return scoped_read(identity.subject, query)


@router.get("/recruiter/workspaces", response_model=list[Workspace])
def recruiter_workspaces(identity: Identity = Depends(require_identity)):
    return scoped_read(identity.subject, lambda conn: [dict(row) for row in conn.execute(text("""
        select w.id, w.name from workspaces w
        join workspace_memberships m on m.workspace_id = w.id
        where m.user_id = hp_user_id() order by w.id
    """)).mappings()])


@router.get("/recruiter/workspaces/{workspace_id}/jobs", response_model=list[WorkspaceJob])
def workspace_jobs(workspace_id: str, identity: Identity = Depends(require_identity)):
    def query(conn):
        if not conn.execute(text("select hp_in_workspace(:workspace)"), {"workspace": workspace_id}).scalar_one():
            raise HTTPException(status_code=404, detail="Workspace not found.")
        return [dict(row) for row in conn.execute(text("""
            select j.id, j.title from jobs j
            join workspace_jobs wj on wj.job_id = j.id
            where wj.workspace_id = :workspace order by j.id
        """), {"workspace": workspace_id}).mappings()]
    return scoped_read(identity.subject, query)
