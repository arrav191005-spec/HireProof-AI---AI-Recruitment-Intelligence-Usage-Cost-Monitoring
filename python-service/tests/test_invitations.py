"""Invitation tests use a disposable DB and an actual restricted login."""
import asyncio
import hashlib
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.auth import Identity, require_identity
from app.main import app
from app.scoped_db import scoped_engine

ADMIN = os.environ.get("RLS_TEST_ADMIN_URL")
APP = os.environ.get("RLS_TEST_APP_URL")


@unittest.skipUnless(ADMIN and APP, "requires disposable PostgreSQL and restricted login")
class InvitationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not make_url(ADMIN).database.startswith("hireproof_rls_"):
            self.fail("test database must start with hireproof_rls_")
        self.admin = create_engine(ADMIN)
        self.suffix = uuid4().hex[:12]
        s = self.suffix
        with self.admin.begin() as c:
            for n in ("admin", "invitee", "other"):
                c.execute(text("insert into users(id,auth_user_id,email,role) values (:id,:id,:email,'recruiter')"),
                          {"id": n+s, "email": n+s+"@example.invalid"})
            c.execute(text("insert into workspaces(id,name) values (:id,'Synthetic')"), {"id": "w"+s})
            c.execute(text("insert into workspace_memberships(workspace_id,user_id,role) values (:w,:u,'admin')"),
                      {"w": "w"+s, "u": "admin"+s})
        self.env = patch.dict(os.environ, {"V2_DATABASE_URL": APP})
        self.env.start()
        scoped_engine.cache_clear()
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        scoped_engine().dispose()
        scoped_engine.cache_clear()
        self.env.stop()
        self.admin.dispose()

    def as_user(self, name):
        app.dependency_overrides[require_identity] = lambda: Identity(name+self.suffix)

    async def invite(self):
        self.as_user("admin")
        response = await self.client.post(f"/api/v2/recruiter/workspaces/w{self.suffix}/invitations",
                                          json={"invitee_user_id": "invitee"+self.suffix})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        return response.json()

    async def test_bound_single_use_concurrent_acceptance_and_revocation(self):
        invite = await self.invite()
        with self.admin.connect() as c:
            row = c.execute(text("select token_hash from workspace_invitations where id=:id"), {"id": invite["id"]}).scalar_one()
            self.assertEqual(row, hashlib.sha256(invite["token"].encode()).hexdigest())
            self.assertNotEqual(row, invite["token"])
        self.as_user("other")
        self.assertEqual((await self.client.post("/api/v2/recruiter/invitations/accept", json={"token": invite["token"]})).status_code, 404)
        self.as_user("invitee")
        responses = await asyncio.gather(*[self.client.post("/api/v2/recruiter/invitations/accept",
                                              json={"token": invite["token"]}) for _ in range(3)])
        self.assertEqual(sorted(r.status_code for r in responses), [200, 404, 404])
        self.assertEqual((await self.client.get("/api/v2/recruiter/workspaces")).json()[0]["id"], "w"+self.suffix)
        pending = await self.invite()
        response = await self.client.delete(f"/api/v2/recruiter/workspaces/w{self.suffix}/members/invitee{self.suffix}")
        self.assertEqual(response.status_code, 204)
        self.as_user("invitee")
        self.assertEqual((await self.client.get("/api/v2/recruiter/workspaces")).json(), [])
        self.assertEqual((await self.client.post("/api/v2/recruiter/invitations/accept",
                                                  json={"token": pending["token"]})).status_code, 404)
        with self.admin.connect() as c:
            logs = c.execute(text("select action,metadata::text from audit_logs where metadata->>'invitation_id'=:id"),
                             {"id": invite["id"]}).all()
            self.assertEqual(len(logs), 1)
            self.assertNotIn(invite["token"], str(logs))
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as c:
                c.execute(text("select * from workspace_invitations")).all()

    async def test_expiry_revocation_and_admin_requirement(self):
        invite = await self.invite()
        with self.admin.begin() as c:
            c.execute(text("update workspace_invitations set expires_at=now()-interval '1 second' where id=:id"),
                      {"id": invite["id"]})
        self.as_user("invitee")
        self.assertEqual((await self.client.post("/api/v2/recruiter/invitations/accept", json={"token": invite["token"]})).status_code, 404)
        response = await self.client.post(f"/api/v2/recruiter/workspaces/w{self.suffix}/invitations",
                                          json={"invitee_user_id": "other"+self.suffix})
        self.assertEqual(response.status_code, 404)
        self.as_user("admin")
        response = await self.client.post(f"/api/v2/recruiter/workspaces/w{self.suffix}/invitations",
                                          json={"invitee_user_id": "other"+self.suffix, "role": "admin"})
        self.assertEqual(response.status_code, 422)
        response = await self.client.delete(f"/api/v2/recruiter/workspaces/w{self.suffix}/members/admin{self.suffix}")
        self.assertEqual(response.status_code, 404)
        invite = await self.invite()
        response = await self.client.delete(f"/api/v2/recruiter/workspaces/w{self.suffix}/invitations/{invite['id']}")
        self.assertEqual(response.status_code, 204)
        self.as_user("invitee")
        self.assertEqual((await self.client.post("/api/v2/recruiter/invitations/accept", json={"token": invite["token"]})).status_code, 404)
