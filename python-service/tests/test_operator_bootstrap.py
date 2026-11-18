"""Operator and admin authorization tests against a disposable PostgreSQL DB."""
import asyncio
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.auth import Identity, require_identity
from app.main import app
from app.operator_bootstrap import BootstrapError, confirmed_recruiter, provision, require_operator
from app.scoped_db import scoped_engine

ADMIN = os.environ.get("RLS_TEST_ADMIN_URL")
APP = os.environ.get("RLS_TEST_APP_URL")
OPERATOR = os.environ.get("BOOTSTRAP_TEST_URL")


class ProviderBootstrapTests(unittest.TestCase):
    def test_operator_provider_rejects_unconfirmed_or_mismatched_user(self):
        subject = str(uuid4())
        original_client = httpx.Client
        for payload, allowed in [
            ({"id": subject, "email": "r@example.invalid", "email_confirmed_at": "2026-01-01"}, True),
            ({"id": str(uuid4()), "email": "r@example.invalid", "email_confirmed_at": "2026-01-01"}, False),
            ({"id": subject, "email": "r@example.invalid", "email_confirmed_at": None}, False),
            ({"id": subject, "email": "r@example.invalid", "email_confirmed_at": "2026-01-01", "banned_until": "2099"}, False),
        ]:
            with self.subTest(allowed=allowed), patch.dict(os.environ, {
                "SUPABASE_AUTH_ISSUER": "https://example.supabase.co/auth/v1",
                "SUPABASE_JWT_AUDIENCE": "authenticated",
                "SUPABASE_BOOTSTRAP_SERVICE_KEY": "synthetic-test-key",
            }), patch("app.operator_bootstrap.httpx.Client", side_effect=lambda **kw: original_client(
                transport=httpx.MockTransport(lambda req: httpx.Response(200, json=payload)), **kw
            )):
                if allowed:
                    self.assertEqual(confirmed_recruiter(subject)[0], subject)
                else:
                    with self.assertRaises(BootstrapError):
                        confirmed_recruiter(subject)


@unittest.skipUnless(ADMIN and APP and OPERATOR, "requires disposable DB, restricted runtime and operator logins")
class BootstrapTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not make_url(ADMIN).database.startswith("hireproof_rls_"):
            self.fail("test database must start with hireproof_rls_")
        self.admin = create_engine(ADMIN)
        self.operator = create_engine(OPERATOR)
        self.suffix = uuid4().hex[:12]
        self.subject = str(uuid4())
        self.email = self.suffix + "@example.invalid"
        self.workspace = "ws-" + self.suffix
        self.env = patch.dict(os.environ, {"V2_DATABASE_URL": APP})
        self.env.start()
        scoped_engine.cache_clear()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        scoped_engine().dispose()
        scoped_engine.cache_clear()
        self.env.stop()
        self.operator.dispose()
        self.admin.dispose()

    def bootstrap(self, subject=None, email=None, workspace=None, name="Example"):
        with self.operator.begin() as conn:
            actor = require_operator(conn)
            return provision(conn, actor, subject or self.subject, email or self.email, "Recruiter",
                             workspace or self.workspace, name)

    async def test_concurrent_bootstrap_and_workspace_admin(self):
        results = await asyncio.gather(*[asyncio.to_thread(self.bootstrap) for _ in range(3)])
        self.assertEqual(len({r["user_id"] for r in results}), 1)
        uid = results[0]["user_id"]
        app.dependency_overrides[require_identity] = lambda: Identity(self.subject)
        self.assertEqual((await self.client.get("/api/v2/recruiter/me")).json()["user_id"], uid)
        response = await self.client.patch("/api/v2/recruiter/workspaces/"+self.workspace, json={"name": "Updated"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((await self.client.get("/api/v2/recruiter/workspaces/"+self.workspace)).json()["name"], "Updated")
        with self.admin.connect() as conn:
            self.assertEqual(conn.execute(text("select count(*) from audit_logs where action='workspace.bootstrap' and entity_id=:id"),
                                          {"id": self.workspace}).scalar_one(), 1)
            self.assertEqual(conn.execute(text("select count(*) from audit_logs where action='workspace.update' and entity_id=:id"),
                                          {"id": self.workspace}).scalar_one(), 1)

    async def test_conflicts_and_runtime_cannot_bootstrap(self):
        with scoped_engine().begin() as conn:
            with self.assertRaises(BootstrapError):
                require_operator(conn)
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as conn:
                conn.execute(text("insert into users(id,email,role) values ('bad','bad@example.invalid','recruiter')"))
        self.bootstrap()
        with self.assertRaises(BootstrapError):
            self.bootstrap(subject=str(uuid4()), email="other"+self.email)
        with self.admin.begin() as conn:
            conn.execute(text("insert into users(id,auth_user_id,email,role) values (:id,:sub,:email,'candidate')"),
                         {"id": "student-"+self.suffix, "sub": str(uuid4()), "email": "student"+self.email})
            subject = conn.execute(text("select auth_user_id from users where id=:id"), {"id": "student-"+self.suffix}).scalar_one()
        with self.assertRaises(BootstrapError):
            self.bootstrap(subject=subject, email="student"+self.email, workspace="other-"+self.suffix)
        app.dependency_overrides[require_identity] = lambda: Identity(subject)
        self.assertEqual((await self.client.patch("/api/v2/recruiter/workspaces/"+self.workspace, json={"name":"bad"})).status_code, 404)
        with self.admin.connect() as conn:
            self.assertEqual(conn.execute(text("select count(*) from workspaces where id=:id"),
                                          {"id":"other-"+self.suffix}).scalar_one(), 0)
