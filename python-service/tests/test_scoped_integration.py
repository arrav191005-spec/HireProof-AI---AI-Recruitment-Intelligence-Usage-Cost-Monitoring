"""Actual non-owner PostgreSQL role / RLS tests; disposable database only."""
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.auth import Identity, require_identity
from app.main import app
from app.scoped_db import scoped_engine

ADMIN_URL = os.environ.get("RLS_TEST_ADMIN_URL")
RESTRICTED_URL = os.environ.get("RLS_TEST_APP_URL")


@unittest.skipUnless(ADMIN_URL and RESTRICTED_URL, "requires disposable PostgreSQL and restricted login")
class ScopedIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Refuse accidental execution against a non-disposable database.
        from sqlalchemy.engine import make_url
        if not make_url(ADMIN_URL).database.startswith("hireproof_rls_"):
            self.fail("RLS test database must start with hireproof_rls_")
        self.admin = create_engine(ADMIN_URL)
        self.suffix = uuid4().hex[:12]
        s = self.suffix
        with self.admin.begin() as c:
            for label in ("sa", "sb", "ra", "rb"):
                c.execute(text("insert into users (id,auth_user_id,email,role) values (:id,:auth,:email,:role)"),
                          {"id": label+s, "auth": label+s, "email": label+s+"@example.invalid",
                           "role": "candidate" if label[0] == "s" else "recruiter"})
            for label in ("a", "b", "unassigned"):
                c.execute(text("insert into candidates (id,full_name) values (:id,:name)"), {"id": label+s, "name": label})
            for label in ("a", "b"):
                c.execute(text("insert into candidate_owners (candidate_id,user_id) values (:c,:u)"),
                          {"c": label+s, "u": "s"+label+s})
                project = c.execute(text("insert into projects (candidate_id,name) values (:c,:n) returning id"),
                                    {"c": label+s, "n": "project-"+label}).scalar_one()
                c.execute(text("insert into project_repository_refs (id,project_id,repository_url) values (:id,:p,'https://github.com/example/test')"),
                          {"id": label+s, "p": project})
                c.execute(text("insert into project_claims (id,project_id,claim_text) values (:id,:p,'Python')"),
                          {"id": label+s, "p": project})
                c.execute(text("insert into project_verification_runs (id,project_id,repository_ref_id,status) values (:id,:p,:id,'completed')"),
                          {"id": label+s, "p": project})
                c.execute(text("insert into project_verification_evidence (id,run_id,project_id,claim_id,status,explanation) values (:id,:id,:p,:id,'not_established','Synthetic')"),
                          {"id": label+s, "p": project})
                c.execute(text("insert into workspaces (id,name) values (:id,:name)"), {"id": label+s, "name": label})
                c.execute(text("insert into workspace_memberships (workspace_id,user_id,role) values (:w,:u,'recruiter')"),
                          {"w": label+s, "u": "r"+label+s})
                c.execute(text("insert into jobs (id,title,status) values (:id,:title,'open')"), {"id": label+s, "title": label})
                c.execute(text("insert into workspace_jobs (workspace_id,job_id) values (:w,:j)"), {"w": label+s, "j": label+s})
                c.execute(text("insert into applications (id,candidate_id,job_id) values (:id,:c,:j)"),
                          {"id": label+s, "c": label+s, "j": label+s})
                c.execute(text("insert into certificates (id,candidate_id,title) values (:id,:c,'Synthetic')"),
                          {"id": label+s, "c": label+s})
        self.env = patch.dict(os.environ, {"V2_DATABASE_URL": RESTRICTED_URL})
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

    async def get_as(self, subject, path):
        app.dependency_overrides[require_identity] = lambda: Identity(subject)
        return await self.client.get(path)

    async def test_student_isolation_recruiter_isolation_and_revocation(self):
        s = self.suffix
        self.assertEqual((await self.client.get("/api/v2/candidates/me")).status_code, 401)
        result = await self.get_as("sa"+s, "/api/v2/candidates/me")
        self.assertEqual(result.json()["id"], "a"+s)
        projects = await self.get_as("sa"+s, "/api/v2/candidates/me/projects")
        self.assertEqual([x["name"] for x in projects.json()], ["project-a"])
        self.assertEqual((await self.get_as("unknown"+s, "/api/v2/candidates/me")).status_code, 404)
        self.assertEqual((await self.get_as("ra"+s, "/api/v2/recruiter/workspaces/"+ "b"+s +"/jobs")).status_code, 404)
        self.assertEqual((await self.get_as("ra"+s, "/api/v2/recruiter/workspaces/"+ "a"+s +"/jobs")).status_code, 200)
        with self.admin.begin() as c:
            c.execute(text("delete from workspace_memberships where user_id=:u"), {"u": "ra"+s})
        self.assertEqual((await self.get_as("ra"+s, "/api/v2/recruiter/workspaces/"+ "a"+s +"/jobs")).status_code, 404)

    async def test_rls_and_write_denial_on_actual_login(self):
        s = self.suffix
        engine = scoped_engine()
        with engine.begin() as c:
            user = c.execute(text("""
                select rolsuper, rolbypassrls,
                       pg_has_role(current_user,'hireproof_v2_access','member') as v2_member
                from pg_roles where rolname=current_user
            """)).one()
            self.assertEqual(tuple(user), (False, False, True))
            self.assertEqual(c.execute(text("select count(*) from candidates where id like :s"), {"s": "%"+s}).scalar_one(), 0)
            c.execute(text("select set_config('app.subject',:s,true)"), {"s": "sa"+s})
            ids = c.execute(text("select id from candidates where id like :s"), {"s": "%"+s}).scalars().all()
            self.assertEqual(ids, ["a"+s])
            certs = c.execute(text("select id from certificates where id like :s"), {"s": "%"+s}).scalars().all()
            self.assertEqual(certs, ["a"+s])
            evidence = c.execute(text("select id from project_verification_evidence where id like :s"), {"s": "%"+s}).scalars().all()
            self.assertEqual(evidence, ["a"+s])
        with engine.begin() as c:
            c.execute(text("select set_config('app.subject',:s,true)"), {"s": "ra"+s})
            candidates = c.execute(text("select id from candidates where id like :s"), {"s": "%"+s}).scalars().all()
            self.assertEqual(candidates, ["a"+s])
            evidence = c.execute(text("select id from project_verification_evidence where id like :s"), {"s": "%"+s}).scalars().all()
            self.assertEqual(evidence, ["a"+s])
        with engine.connect() as c:
            self.assertFalse(c.execute(text("select nullif(current_setting('app.subject',true),'') is not null")).scalar_one())
        with engine.begin() as c:
            self.assertEqual(c.execute(text("update candidates set full_name='wrong'")).rowcount, 0)
        with self.assertRaises(SQLAlchemyError):
            with engine.begin() as c:
                c.execute(text("update candidates set id='wrong'"))

    async def test_scoped_endpoint_rejects_superuser_connection(self):
        scoped_engine.cache_clear()
        with patch.dict(os.environ, {"V2_DATABASE_URL": ADMIN_URL}):
            try:
                response = await self.get_as("sa"+self.suffix, "/api/v2/candidates/me")
                self.assertEqual(response.status_code, 503)
            finally:
                scoped_engine().dispose()
                scoped_engine.cache_clear()

    async def test_recruiter_job_writes_are_scoped_and_audited(self):
        s = self.suffix
        app.dependency_overrides[require_identity] = lambda: Identity("ra"+s)
        prefix = "/api/v2/recruiter/workspaces/"
        forbidden = await self.client.post(prefix+"b"+s+"/jobs", json={"title": "No"})
        self.assertEqual(forbidden.status_code, 404)
        created = await self.client.post(prefix+"a"+s+"/jobs", json={"title": "New job"})
        self.assertEqual(created.status_code, 201, created.text)
        job_id = created.json()["id"]
        response = await self.client.patch(prefix+"a"+s+"/jobs/"+job_id, json={"title": "Updated"})
        self.assertEqual(response.status_code, 200, response.text)
        response = await self.client.patch(prefix+"a"+s+"/jobs/"+"b"+s, json={"title": "No"})
        self.assertEqual(response.status_code, 404)
        response = await self.client.post(prefix+"a"+s+"/jobs", json={"title": "No", "role": "admin"})
        self.assertEqual(response.status_code, 422)
        with self.admin.begin() as c:
            self.assertEqual(c.execute(text("select status from jobs where id=:id"), {"id": job_id}).scalar_one(), "draft")
            actions = c.execute(text("select action from audit_logs where entity_id=:id order by action"), {"id": job_id}).scalars().all()
            self.assertEqual(actions, ["job.create", "job.update"])
            c.execute(text("delete from workspace_memberships where user_id=:u"), {"u": "ra"+s})
        response = await self.client.patch(prefix+"a"+s+"/jobs/"+job_id, json={"title": "No"})
        self.assertEqual(response.status_code, 404)
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as c:
                c.execute(text("select set_config('app.subject',:u,true)"), {"u": "ra"+s})
                c.execute(text("update jobs set status='open' where id=:id"), {"id": job_id})
