"""Operator-only recruiter provisioning and first-workspace bootstrap.

This module is a CLI, not an HTTP route. It requires both a dedicated database
operator login and a Supabase admin credential, supplied only through the
operator's secret manager. It never prints credentials or provider responses.
"""
import argparse
import os
import re
import sys
from uuid import UUID, uuid4

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError


class BootstrapError(Exception):
    pass


def confirmed_recruiter(subject: str) -> tuple[str, str]:
    from .auth import auth_settings
    from fastapi import HTTPException
    try:
        subject = str(UUID(subject))
        issuer, _ = auth_settings()
    except (ValueError, HTTPException):
        raise BootstrapError("Provider configuration or subject is invalid.") from None
    key = os.environ.get("SUPABASE_BOOTSTRAP_SERVICE_KEY", "").strip()
    if not key:
        raise BootstrapError("Provider operator credential is not configured.")
    try:
        with httpx.Client(timeout=5, follow_redirects=False) as client:
            with client.stream("GET", issuer + "/admin/users/" + subject,
                               headers={"Authorization": "Bearer " + key, "apikey": key}) as response:
                if response.status_code != 200:
                    raise BootstrapError("Provider identity could not be verified.")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 65536:
                        raise BootstrapError("Provider response exceeded the limit.")
        import json
        data = json.loads(raw)
        email = data.get("email")
        if (data.get("id") != subject or not data.get("email_confirmed_at")
                or data.get("deleted_at") or data.get("banned_until")
                or not isinstance(email, str) or len(email) > 254
                or not re.fullmatch(r"[^@\s]+@[^@\s]+", email)):
            raise BootstrapError("Provider identity is not eligible.")
        return subject, email.strip().lower()
    except (httpx.HTTPError, ValueError, AttributeError):
        raise BootstrapError("Provider identity could not be verified.") from None


def operator_engine():
    raw = os.environ.get("BOOTSTRAP_DATABASE_URL", "").strip()
    if not raw:
        raise BootstrapError("Operator database is not configured.")
    try:
        url = make_url(raw)
        if url.get_backend_name() != "postgresql":
            raise BootstrapError("Operator database configuration is invalid.")
        url = url.set(drivername="postgresql+psycopg")
        if "sslmode" not in url.query:
            url = url.update_query_dict({"sslmode": "verify-full"})
        return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})
    except (ValueError, SQLAlchemyError):
        raise BootstrapError("Operator database configuration is invalid.") from None


def require_operator(conn) -> str:
    row = conn.execute(text("""
        select current_user as actor,
          not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole
          and pg_has_role(current_user, 'hireproof_bootstrap_operator', 'member')
          and not pg_has_role(current_user, 'hireproof_v2_access', 'member') as allowed
        from pg_roles r where r.rolname=current_user
    """)).mappings().one()
    if not row["allowed"]:
        raise BootstrapError("Database identity is not an authorized operator.")
    return row["actor"]


def provision(conn, actor: str, subject: str, email: str, display_name: str,
              workspace_id: str | None = None, workspace_name: str | None = None) -> dict:
    # Permission is rechecked in the same transaction; callers cannot nominate
    # an arbitrary audit actor even if they invoke this helper directly.
    if actor != require_operator(conn):
        raise BootstrapError("Database identity is not an authorized operator.")
    if not 1 <= len(display_name.strip()) <= 120:
        raise BootstrapError("Display name is invalid.")
    if workspace_id is not None and (not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", workspace_id)
                                      or not workspace_name or not 1 <= len(workspace_name.strip()) <= 120):
        raise BootstrapError("Workspace details are invalid.")
    conn.execute(text("select pg_advisory_xact_lock(hashtextextended(:k,0))"), {"k": "student-subject:"+subject})
    conn.execute(text("select pg_advisory_xact_lock(hashtextextended(:k,0))"), {"k": "student-email:"+email})
    user = conn.execute(text("select id,email,role from users where auth_user_id=:sub"), {"sub": subject}).mappings().first()
    if user:
        if user["role"] != "recruiter" or user["email"].lower() != email:
            raise BootstrapError("Identity conflicts with an existing account.")
        uid = user["id"]
    else:
        if conn.execute(text("select exists(select 1 from users where lower(email)=:email)"), {"email": email}).scalar_one():
            raise BootstrapError("Identity conflicts with an existing account.")
        uid = "user-" + uuid4().hex
        conn.execute(text("insert into users(id,auth_user_id,email,role) values (:id,:sub,:email,'recruiter')"),
                     {"id": uid, "sub": subject, "email": email})
        conn.execute(text("insert into recruiter_profiles(user_id,display_name) values (:uid,:name)"),
                     {"uid": uid, "name": display_name.strip()})
        audit(conn, actor, "recruiter.provision", "user", uid, {"target_user_id": uid})
    if not conn.execute(text("select exists(select 1 from recruiter_profiles where user_id=:id)"), {"id": uid}).scalar_one():
        raise BootstrapError("Existing recruiter profile requires operator review.")
    if workspace_id is not None:
        conn.execute(text("select pg_advisory_xact_lock(hashtextextended(:k,0))"), {"k": "workspace-bootstrap:"+workspace_id})
        existing = conn.execute(text("select id,name from workspaces where id=:id"), {"id": workspace_id}).mappings().first()
        if existing:
            previous = conn.execute(text("""
                select exists(select 1 from audit_logs where action='workspace.bootstrap'
                   and entity_id=:wid and metadata->>'target_user_id'=:uid)
                  and exists(select 1 from workspace_memberships where workspace_id=:wid
                   and user_id=:uid and role='admin')
            """), {"wid": workspace_id, "uid": uid}).scalar_one()
            if not previous or existing["name"] != workspace_name.strip():
                raise BootstrapError("Workspace conflicts with existing records.")
        else:
            conn.execute(text("insert into workspaces(id,name) values (:id,:name)"),
                         {"id": workspace_id, "name": workspace_name.strip()})
            conn.execute(text("insert into workspace_memberships(workspace_id,user_id,role) values (:wid,:uid,'admin')"),
                         {"wid": workspace_id, "uid": uid})
            audit(conn, actor, "workspace.bootstrap", "workspace", workspace_id, {"target_user_id": uid})
    return {"user_id": uid, **({"workspace_id": workspace_id} if workspace_id is not None else {})}


def audit(conn, actor, action, entity_type, entity_id, metadata):
    import json
    conn.execute(text("""insert into audit_logs(id,actor,action,entity_type,entity_id,metadata)
                         values (:id,:actor,:action,:type,:entity,cast(:metadata as jsonb))"""),
                 {"id": "audit-"+uuid4().hex, "actor": "db:"+actor, "action": action,
                  "type": entity_type, "entity": entity_id, "metadata": json.dumps(metadata)})


def main():
    parser = argparse.ArgumentParser(description="Operator-only recruiter provisioning.")
    parser.add_argument("--subject", required=True, help="Supabase user UUID")
    parser.add_argument("--display-name", required=True)
    parser.add_argument("--workspace-id")
    parser.add_argument("--workspace-name")
    parser.add_argument("--confirm", action="store_true", help="Explicitly approve this operation")
    args = parser.parse_args()
    if not args.confirm or bool(args.workspace_id) != bool(args.workspace_name):
        parser.error("Require --confirm and provide both workspace arguments or neither.")
    engine = None
    try:
        engine = operator_engine()
        # Verify operator authority before contacting the identity provider.
        with engine.begin() as conn:
            require_operator(conn)
        subject, email = confirmed_recruiter(args.subject)
        with engine.begin() as conn:
            actor = require_operator(conn)
            result = provision(conn, actor, subject, email, args.display_name,
                               args.workspace_id, args.workspace_name)
        print("Provisioned user:", result["user_id"])
        if "workspace_id" in result:
            print("Workspace:", result["workspace_id"])
    except (BootstrapError, SQLAlchemyError):
        # Provider responses, SQL, URLs, email and credentials are never printed.
        print("Provisioning failed; check operator access, identity and conflicts.", file=sys.stderr)
        return 1
    finally:
        if engine is not None:
            engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
