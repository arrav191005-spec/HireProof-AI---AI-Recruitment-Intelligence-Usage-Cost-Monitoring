"""Read-only private API. Writes and verification execution remain disabled."""
from fastapi import APIRouter, Depends, HTTPException, Response
import hashlib
import secrets
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from ..auth import Identity, bearer, require_identity
from fastapi.security import HTTPAuthorizationCredentials
from datetime import datetime
from ..provider_identity import confirmed_email
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


class InvitationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    invitee_user_id: str = Field(min_length=1, max_length=128)


class InvitationToken(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=32, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class CreatedInvitation(BaseModel):
    id: str
    token: str


class AcceptedInvitation(BaseModel):
    workspace_id: str


class StudentIdentity(BaseModel):
    user_id: str


class RecruiterProfile(BaseModel):
    user_id: str
    display_name: str


class WorkspaceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)


class PendingInvitation(BaseModel):
    id: str
    invitee_user_id: str
    created_at: datetime
    expires_at: datetime


def require_workspace_admin(conn, workspace_id):
    ok = conn.execute(text("""
        select exists(select 1 from workspace_memberships
          where workspace_id=:wid and user_id=hp_user_id() and role='admin')
    """), {"wid": workspace_id}).scalar_one()
    if not ok:
        raise HTTPException(status_code=404, detail="Workspace not found.")


@router.post("/accounts/student", response_model=StudentIdentity)
def provision_student_identity(identity: Identity = Depends(require_identity),
                               credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    email = confirmed_email(identity, credentials.credentials)
    def write(conn):
        user_id = conn.execute(text("select hp_provision_student_identity(:email)"), {"email": email}).scalar_one()
        if user_id is None:
            raise HTTPException(status_code=409, detail="Identity cannot be provisioned automatically.")
        return {"user_id": user_id}
    return scoped_read(identity.subject, write)


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


@router.get("/recruiter/me", response_model=RecruiterProfile)
def recruiter_profile(identity: Identity = Depends(require_identity)):
    def query(conn):
        row = conn.execute(text("select user_id,display_name from recruiter_profiles where user_id=hp_user_id()")).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Recruiter profile not found.")
        return dict(row)
    return scoped_read(identity.subject, query)


@router.get("/recruiter/workspaces/{workspace_id}", response_model=Workspace)
def workspace_detail(workspace_id: str, identity: Identity = Depends(require_identity)):
    def query(conn):
        row = conn.execute(text("select id,name from workspaces where id=:id and hp_in_workspace(:id)"),
                           {"id": workspace_id}).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Workspace not found.")
        return dict(row)
    return scoped_read(identity.subject, query)


@router.patch("/recruiter/workspaces/{workspace_id}", response_model=Workspace)
def update_workspace(workspace_id: str, body: WorkspaceUpdate, identity: Identity = Depends(require_identity)):
    def write(conn):
        require_workspace_admin(conn, workspace_id)
        if not conn.execute(text("select hp_update_workspace(:id,:name)"),
                            {"id": workspace_id, "name": body.name}).scalar_one():
            raise HTTPException(status_code=404, detail="Workspace not found.")
        return {"id": workspace_id, "name": body.name}
    return scoped_read(identity.subject, write)


@router.get("/recruiter/workspaces/{workspace_id}/invitations", response_model=list[PendingInvitation])
def pending_invitations(workspace_id: str, identity: Identity = Depends(require_identity)):
    def query(conn):
        require_workspace_admin(conn, workspace_id)
        return [dict(row) for row in conn.execute(text("select * from hp_pending_invitations(:id)"),
                                                   {"id": workspace_id}).mappings()]
    return scoped_read(identity.subject, query)


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


@router.post("/recruiter/workspaces/{workspace_id}/invitations",
             response_model=CreatedInvitation, status_code=201)
def create_invitation(workspace_id: str, body: InvitationCreate, response: Response,
                      identity: Identity = Depends(require_identity)):
    response.headers["Cache-Control"] = "no-store"
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    def write(conn):
        require_workspace_admin(conn, workspace_id)
        invitation_id = conn.execute(text("select hp_create_invitation(:wid,:invitee,:digest)"),
            {"wid": workspace_id, "invitee": body.invitee_user_id, "digest": digest}).scalar_one()
        return {"id": invitation_id, "token": token}
    return scoped_read(identity.subject, write)


@router.post("/recruiter/invitations/accept", response_model=AcceptedInvitation)
def accept_invitation(body: InvitationToken, identity: Identity = Depends(require_identity)):
    digest = hashlib.sha256(body.token.encode("ascii")).hexdigest()
    def write(conn):
        workspace_id = conn.execute(text("select hp_accept_invitation(:digest)"), {"digest": digest}).scalar_one()
        if workspace_id is None:
            raise HTTPException(status_code=404, detail="Invitation unavailable.")
        return {"workspace_id": workspace_id}
    return scoped_read(identity.subject, write)


@router.delete("/recruiter/workspaces/{workspace_id}/invitations/{invitation_id}", status_code=204)
def revoke_invitation(workspace_id: str, invitation_id: str, identity: Identity = Depends(require_identity)):
    def write(conn):
        require_workspace_admin(conn, workspace_id)
        if not conn.execute(text("select hp_revoke_invitation(:wid,:iid)"),
                            {"wid": workspace_id, "iid": invitation_id}).scalar_one():
            raise HTTPException(status_code=404, detail="Invitation unavailable.")
    scoped_read(identity.subject, write)


@router.delete("/recruiter/workspaces/{workspace_id}/members/{user_id}", status_code=204)
def revoke_member(workspace_id: str, user_id: str, identity: Identity = Depends(require_identity)):
    def write(conn):
        require_workspace_admin(conn, workspace_id)
        if not conn.execute(text("select hp_revoke_recruiter(:wid,:target)"),
                            {"wid": workspace_id, "target": user_id}).scalar_one():
            raise HTTPException(status_code=404, detail="Membership unavailable.")
    scoped_read(identity.subject, write)
