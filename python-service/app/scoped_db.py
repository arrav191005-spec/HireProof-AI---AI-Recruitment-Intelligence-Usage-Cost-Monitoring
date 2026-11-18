"""RLS-scoped read sessions for private V2 endpoints."""
import os
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError


@lru_cache(maxsize=1)
def scoped_engine():
    raw = os.environ.get("V2_DATABASE_URL", "").strip()
    if not raw:
        raise ValueError("not configured")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        raise ValueError("invalid backend")
    url = url.set(drivername="postgresql+psycopg")
    if "sslmode" not in url.query:
        url = url.update_query_dict({"sslmode": "verify-full"})
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})


def scoped_read(subject, callback):
    """Set a verified subject only within this transaction, after checking role."""
    try:
        with scoped_engine().begin() as conn:
            safe = conn.execute(text("""
                select not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole
                  and pg_has_role(current_user, 'hireproof_v2_access', 'member')
                  and not has_schema_privilege(current_user, 'public', 'CREATE')
                  and not exists (
                    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname in
                      ('users','candidates','resumes','projects','applications','jobs',
                       'candidate_owners','workspaces','workspace_memberships','workspace_jobs',
                       'project_verification_runs','project_verification_evidence',
                       'certificates','certificate_verification_runs')
                      and pg_has_role(current_user, c.relowner, 'MEMBER')
                  )
                from pg_roles r where r.rolname=current_user
            """)).scalar_one()
            if not safe:
                raise HTTPException(status_code=503, detail="Private database access is not safely configured.")
            conn.execute(text("select set_config('app.subject', :subject, true)"), {"subject": subject})
            return callback(conn)
    except HTTPException:
        raise
    except (SQLAlchemyError, ValueError):
        raise HTTPException(status_code=503, detail="Private database access is unavailable.") from None
