"""Student-write tests against a disposable DB and real restricted login."""
import asyncio
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


@unittest.skipUnless(ADMIN and APP, "requires disposable PostgreSQL and restricted role")
class StudentWrites(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not make_url(ADMIN).database.startswith("hireproof_rls_"):
            self.fail("test database must start with hireproof_rls_")
        self.admin = create_engine(ADMIN)
        self.s = uuid4().hex[:12]
        with self.admin.begin() as c:
            for n, role in [("a", "candidate"), ("b", "candidate"), ("r", "recruiter")]:
                user = n + self.s
                c.execute(text("insert into users (id,auth_user_id,email,role) values (:u,:u,:e,:r)"),
                          {"u": user, "e": user + "@example.invalid", "r": role})
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

    def as_user(self, user):
        app.dependency_overrides[require_identity] = lambda: Identity(user + self.s)

    async def test_provision_idempotent_concurrent_and_audit(self):
        self.as_user("a")
        responses = await asyncio.gather(*[
            self.client.post("/api/v2/candidates/me", json={"full_name": "Example"})
            for _ in range(4)
        ])
        self.assertTrue(all(r.status_code == 200 for r in responses), [r.text for r in responses])
        ids = {r.json()["id"] for r in responses}
        self.assertEqual(len(ids), 1)
        self.assertEqual((await self.client.patch("/api/v2/candidates/me", json={"full_name": "Updated"})).status_code, 200)
        with self.admin.connect() as c:
            actions = c.execute(text("select action from audit_logs where actor=:u order by action"), {"u": "a"+self.s}).scalars().all()
            self.assertEqual(actions, ["candidate.create", "candidate.update"])

    async def test_project_isolation_and_protected_fields(self):
        self.as_user("a")
        await self.client.post("/api/v2/candidates/me", json={"full_name": "Student A"})
        project = await self.client.post("/api/v2/candidates/me/projects", json={"name": "A project"})
        self.assertEqual(project.status_code, 201, project.text)
        project_id = project.json()["id"]
        second = await self.client.post("/api/v2/candidates/me/projects",
                                        json={"name": "Another project", "summary": "Second"})
        self.assertEqual(second.status_code, 201, second.text)
        self.assertNotEqual(second.json()["id"], project_id)
        projects = await self.client.get("/api/v2/candidates/me/projects")
        self.assertEqual([p["name"] for p in projects.json()], ["A project", "Another project"])
        updated = await self.client.patch(f"/api/v2/candidates/me/projects/{project_id}",
                                          json={"name": "Updated project", "summary": "New description"})
        self.assertEqual(updated.json()["name"], "Updated project")
        self.as_user("b")
        await self.client.post("/api/v2/candidates/me", json={"full_name": "Student B"})
        self.assertEqual((await self.client.patch(f"/api/v2/candidates/me/projects/{project_id}",
                                                  json={"name": "Hijack"})).status_code, 404)
        self.assertEqual((await self.client.post("/api/v2/candidates/me/projects",
                                                json={"name": "Bad", "candidate_id": "other"})).status_code, 422)
        self.assertEqual((await self.client.post("/api/v2/candidates/me",
                                                json={"full_name": "Bad", "user_id": "other"})).status_code, 422)
        with self.admin.connect() as c:
            self.assertEqual(c.execute(text("select count(*) from audit_logs where actor=:u and action='project.create'"),
                                       {"u": "a"+self.s}).scalar_one(), 2)
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as c:
                c.execute(text("select set_config('app.subject',:u,true)"), {"u": "b"+self.s})
                c.execute(text("update projects set candidate_id='other' where id=:id"), {"id": project_id})
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as c:
                c.execute(text("select set_config('app.subject',:u,true)"), {"u": "a"+self.s})
                c.execute(text("insert into projects(candidate_id,name) values (:cid,'direct')"),
                          {"cid": c.execute(text("select candidate_id from candidate_owners where user_id=:u"),
                                            {"u": "a"+self.s}).scalar_one()})
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as c:
                c.execute(text("delete from audit_logs"))

    async def test_untrusted_identity_and_recruiter_cannot_provision_student(self):
        self.as_user("r")
        self.assertEqual((await self.client.post("/api/v2/candidates/me", json={"full_name": "No"})).status_code, 403)
        self.as_user("unknown")
        self.assertEqual((await self.client.post("/api/v2/candidates/me", json={"full_name": "No"})).status_code, 403)

    async def test_failed_transaction_rolls_back_data_and_audit(self):
        self.as_user("a")
        response = await self.client.post("/api/v2/candidates/me", json={"full_name": "Before"})
        candidate_id = response.json()["id"]
        with self.assertRaises(RuntimeError):
            with scoped_engine().begin() as c:
                c.execute(text("select set_config('app.subject',:u,true)"), {"u": "a"+self.s})
                c.execute(text("update candidates set full_name='After' where id=:id"), {"id": candidate_id})
                raise RuntimeError("synthetic failure")
        with self.admin.connect() as c:
            name = c.execute(text("select full_name from candidates where id=:id"), {"id": candidate_id}).scalar_one()
            count = c.execute(text("select count(*) from audit_logs where actor=:u and action='candidate.update'"),
                              {"u": "a"+self.s}).scalar_one()
        self.assertEqual(name, "Before")
        self.assertEqual(count, 0)
