"""Verification endpoints deliberately unavailable until authorization exists."""
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v2", tags=["verification"])


def disabled():
    raise HTTPException(status_code=503, detail="Verification is disabled until authorization is available.")


@router.post("/projects")
def register_project():
    disabled()


@router.post("/projects/{project_id}/verify")
def start_verification(project_id: int):
    disabled()


@router.post("/projects/{project_id}/reverify")
def reverify(project_id: int):
    disabled()


@router.get("/verification-runs/{run_id}")
def get_verification(run_id: str):
    disabled()


@router.get("/verification-evidence/{evidence_id}")
def get_evidence(evidence_id: str):
    disabled()
