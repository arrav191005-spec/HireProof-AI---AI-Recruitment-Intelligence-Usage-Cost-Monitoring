"""Transactional persistence for already-collected verification findings.

This internal primitive is not an authorization boundary. It must not be
exposed through an endpoint until candidate/workspace access is implemented.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from .github_verification import Finding
from .models import ProjectVerificationEvidence, ProjectVerificationRun


def save_completed_run(session: Session, project_id: int, repository_ref_id: str,
                       commit_sha: str, claim_findings: list[tuple[str, Finding]]) -> str:
    run_id = "pvr-" + uuid.uuid4().hex
    session.add(ProjectVerificationRun(id=run_id, project_id=project_id,
                                      repository_ref_id=repository_ref_id,
                                      status="completed", commit_sha=commit_sha,
                                      error_code=None, finished_at=datetime.now(timezone.utc)))
    session.flush()
    for claim_id, finding in claim_findings:
        session.add(ProjectVerificationEvidence(
            id="pve-" + uuid.uuid4().hex, run_id=run_id, project_id=project_id,
            claim_id=claim_id, status=finding.status, source_url=finding.source_url,
            file_path=finding.file_path, commit_sha=finding.commit_sha,
            explanation=finding.explanation,
        ))
    session.flush()
    return run_id
