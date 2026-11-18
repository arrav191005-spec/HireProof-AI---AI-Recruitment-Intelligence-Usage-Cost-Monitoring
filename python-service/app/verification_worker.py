"""Single-job durable verification worker. Run from an external scheduler.

No candidate code is cloned or executed. The worker uses its own restricted
database login; it does not use the API runtime or migration credentials.
"""
import json
import os

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from .github_verification import GitHubCollector, VerificationUnavailable, github_headers, evaluate_claims


class WorkerConfigurationError(Exception):
    pass


def github_token() -> str | None:
    """Optional server-side token. Invalid values fail closed without logging."""
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        return None
    if len(token) > 255 or not token.isascii() or any(char.isspace() for char in token):
        raise WorkerConfigurationError()
    return token


def worker_engine():
    raw = os.environ.get("VERIFICATION_WORKER_DATABASE_URL", "").strip()
    if not raw:
        raise WorkerConfigurationError()
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        raise WorkerConfigurationError()
    url = url.set(drivername="postgresql+psycopg")
    if "sslmode" not in url.query:
        url = url.update_query_dict({"sslmode": "verify-full"})
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})


def assert_worker_role(conn):
    allowed = conn.execute(text("""
      select not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole
        and pg_has_role(current_user,'hireproof_verification_worker','member')
        and not pg_has_role(current_user,'hireproof_v2_access','member')
        and not has_schema_privilege(current_user,'public','CREATE')
        and not exists (
          select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname in
            ('verification_jobs','project_verification_runs','project_verification_evidence')
            and pg_has_role(current_user,c.relowner,'MEMBER')
        )
      from pg_roles r where r.rolname=current_user
    """)).scalar_one()
    if not allowed:
        raise WorkerConfigurationError()


def process_one(engine, client: httpx.Client) -> str:
    with engine.begin() as conn:
        assert_worker_role(conn)
        job = conn.execute(text("select * from hp_claim_verification_job()")).mappings().first()
    if job is None:
        return "idle"
    error = None
    sha = None
    results = None
    try:
        snapshot = GitHubCollector(client).collect(job["repository_url"])
        sha = snapshot["commit_sha"]
        claims = job["claims"]
        evaluated = evaluate_claims(snapshot, [claim["claim"] for claim in claims])
        results = [
            {"claim_id": claim["id"], "status": finding.status,
             "explanation": finding.explanation, "source_url": finding.source_url,
             "file_path": finding.file_path}
            for claim, finding in zip(claims, evaluated, strict=True)
        ]
    except VerificationUnavailable as exc:
        error = exc.code
    except Exception:
        # Never log candidate data, repository paths, or provider responses.
        error = "internal_error"
    with engine.begin() as conn:
        assert_worker_role(conn)
        saved = conn.execute(text("""
            select hp_finish_verification_job(:id,:token,:sha,cast(:findings as jsonb),:error)
        """), {"id": job["job_id"], "token": job["lease_token"], "sha": sha,
               "findings": json.dumps(results) if results is not None else None, "error": error}).scalar_one()
    return "processed" if saved else "lease_expired"


def main():
    if os.environ.get("VERIFICATION_ENABLED") != "true":
        print("Verification is disabled.")
        return 1
    engine = None
    try:
        engine = worker_engine()
        with httpx.Client(headers=github_headers(github_token())) as client:
            print(process_one(engine, client))
        return 0
    except (WorkerConfigurationError, SQLAlchemyError, ValueError):
        print("Verification worker unavailable.")
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
