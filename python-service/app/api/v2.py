"""Initial V2 API boundary.

The legacy document endpoints remain available while application capabilities
are migrated incrementally. This endpoint is a liveness check, not a check of
database, storage, authentication, or external provider readiness.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .. import config
from ..db import DatabaseNotConfigured, get_engine
from ..models import Job
from ..auth import Identity, require_identity

router = APIRouter(prefix="/api/v2", tags=["v2"])


class V2HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@router.get("/health", response_model=V2HealthResponse)
def health() -> V2HealthResponse:
    return V2HealthResponse(
        status="ok",
        service=config.SERVICE_NAME,
        version=config.SERVICE_VERSION,
    )


@router.get("/me")
def current_identity(identity: Identity = Depends(require_identity)):
    """Verified provider subject only; no role or profile is inferred."""
    return {"subject": identity.subject}


@router.get("/ready")
def readiness():
    """Check connectivity and the existing jobs table, not all dependencies."""
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
            connection.execute(text("SELECT id, title, status FROM jobs LIMIT 0"))
    except (DatabaseNotConfigured, SQLAlchemyError, ValueError):
        raise HTTPException(status_code=503, detail="Database unavailable or schema not ready.")
    return {"status": "ready", "database": "ready"}


class PublicJob(BaseModel):
    id: str
    title: str


@router.get("/jobs", response_model=list[PublicJob])
def list_open_jobs():
    """Public, minimal open-job listing; no recruiter or candidate data."""
    try:
        with Session(get_engine()) as session:
            jobs = session.scalars(
                select(Job).where(Job.status == "open").order_by(Job.id).limit(100)
            ).all()
            return [PublicJob(id=job.id, title=job.title) for job in jobs]
    except (DatabaseNotConfigured, SQLAlchemyError, ValueError):
        raise HTTPException(status_code=503, detail="Database unavailable or schema not ready.")
