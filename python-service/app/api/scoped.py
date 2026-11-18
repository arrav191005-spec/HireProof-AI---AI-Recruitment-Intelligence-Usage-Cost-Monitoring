"""Read-only private API. Writes and verification execution remain disabled."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
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


class CandidateProvision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    full_name: str = Field(min_length=1, max_length=120)


class CandidateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    full_name: str = Field(min_length=1, max_length=120)


class ProjectWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=2000)


class JobWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)


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


@router.post("/candidates/me", response_model=CandidateProfile)
def provision_candidate(body: CandidateProvision, identity: Identity = Depends(require_identity)):
    def write(conn):
        if not conn.execute(text("select hp_can_provision_candidate()")).scalar_one():
            raise HTTPException(status_code=403, detail="Student provisioning is not authorized.")
        conn.execute(text("select hp_provision_candidate(:name)"), {"name": body.full_name})
        return own_candidate(conn)
    return scoped_read(identity.subject, write)


@router.patch("/candidates/me", response_model=CandidateProfile)
def update_candidate(body: CandidateUpdate, identity: Identity = Depends(require_identity)):
    def write(conn):
        candidate = own_candidate(conn)
        row = conn.execute(text(
            "update candidates set full_name=:name where id=:id returning id, full_name"
        ), {"name": body.full_name, "id": candidate["id"]}).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Candidate profile not found.")
        return dict(row)
    return scoped_read(identity.subject, write)


@router.get("/candidates/me/projects", response_model=list[CandidateProject])
def candidate_projects(identity: Identity = Depends(require_identity)):
    def query(conn):
        candidate = own_candidate(conn)
        return [dict(row) for row in conn.execute(text(
            "select id, name from projects where candidate_id=:candidate order by id"
        ), {"candidate": candidate["id"]}).mappings()]
    return scoped_read(identity.subject, query)


@router.post("/candidates/me/projects", response_model=CandidateProject, status_code=201)
def create_project(body: ProjectWrite, identity: Identity = Depends(require_identity)):
    def write(conn):
        candidate = own_candidate(conn)
        row = conn.execute(text(
            "insert into projects (candidate_id,name,summary) values (:cid,:name,:summary) returning id,name"
        ), {"cid": candidate["id"], "name": body.name, "summary": body.summary}).mappings().one()
        return dict(row)
    return scoped_read(identity.subject, write)


@router.patch("/candidates/me/projects/{project_id}", response_model=CandidateProject)
def update_project(project_id: int, body: ProjectWrite, identity: Identity = Depends(require_identity)):
    def write(conn):
        candidate = own_candidate(conn)
        row = conn.execute(text("""
            update projects set name=:name, summary=:summary
            where id=:id and candidate_id=:cid returning id,name
        """), {"id": project_id, "cid": candidate["id"], "name": body.name,
                "summary": body.summary}).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        return dict(row)
    return scoped_read(identity.subject, write)


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


@router.post("/recruiter/workspaces/{workspace_id}/jobs", response_model=WorkspaceJob, status_code=201)
def create_workspace_job(workspace_id: str, body: JobWrite, identity: Identity = Depends(require_identity)):
    def write(conn):
        if not conn.execute(text("select hp_in_workspace(:wid)"), {"wid": workspace_id}).scalar_one():
            raise HTTPException(status_code=404, detail="Workspace not found.")
        job_id = conn.execute(text("select hp_create_workspace_job(:wid,:title)"),
                              {"wid": workspace_id, "title": body.title}).scalar_one()
        return {"id": job_id, "title": body.title}
    return scoped_read(identity.subject, write)


@router.patch("/recruiter/workspaces/{workspace_id}/jobs/{job_id}", response_model=WorkspaceJob)
def update_workspace_job(workspace_id: str, job_id: str, body: JobWrite,
                         identity: Identity = Depends(require_identity)):
    def write(conn):
        if not conn.execute(text("select hp_in_workspace(:wid)"), {"wid": workspace_id}).scalar_one():
            raise HTTPException(status_code=404, detail="Workspace not found.")
        row = conn.execute(text("""
            update jobs set title=:title
            where id=:id and exists (
              select 1 from workspace_jobs where job_id=jobs.id and workspace_id=:wid
            ) returning id,title
        """), {"title": body.title, "id": job_id, "wid": workspace_id}).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Job not found.")
        return dict(row)
    return scoped_read(identity.subject, write)
