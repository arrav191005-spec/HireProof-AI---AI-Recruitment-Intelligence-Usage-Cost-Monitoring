"""Scoped GitHub verification tests against disposable PostgreSQL and mocks."""
import asyncio
import base64
import json
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
from app.scoped_db import scoped_engine
from app.verification_monitor import collect as collect_metrics
from app.verification_worker import process_one, worker_engine

ADMIN = os.environ.get("RLS_TEST_ADMIN_URL")
APP = os.environ.get("RLS_TEST_APP_URL")
WORKER = os.environ.get("VERIFICATION_TEST_WORKER_URL")
SHA = "b" * 40
ROOT = "/repos/example/project"


def github_fixture(request):
    path = request.url.path
    if path == ROOT:
        return httpx.Response(200, json={"private": False, "default_branch": "main"})
    if path == ROOT + "/commits/main":
        return httpx.Response(200, json={"sha": SHA})
    if path == ROOT + "/languages":
        return httpx.Response(200, json={"Python": 120, "TypeScript": 80})
    if path == ROOT + "/git/trees/" + SHA:
        return httpx.Response(200, json={"tree": [
            {"type": "blob", "path": "README.md", "size": 12},
            {"type": "blob", "path": "package.json", "size": 30},
            {"type": "blob", "path": "app/main.py", "size": 40},
            {"type": "blob", "path": "huge.py", "size": 70_000},
            {"type": "blob", "path": "src/App.tsx", "size": 60},
        ], "truncated": False})
    if "/contents/" in path:
        if path.endswith("huge.py"):
            return httpx.Response(200, json={"encoding": "base64", "content": "QQ=="})
        content = (b'{"dependencies":{"react":"1"}}' if path.endswith("package.json")
                   else b"from fastapi import FastAPI" if path.endswith("main.py")
                   else b"export const App = () => null")
        return httpx.Response(200, json={"encoding": "base64", "content": base64.b64encode(content).decode()})
    return httpx.Response(404)


def always(status, headers=None):
    return lambda request: httpx.Response(status, headers=headers or {})


@unittest.skipUnless(ADMIN and APP and WORKER, "requires disposable DB plus restricted API and worker logins")
class ProjectVerificationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not make_url(ADMIN).database.startswith("hireproof_rls_"):
            self.fail("test database must start with hireproof_rls_")
        self.admin = create_engine(ADMIN)
        self.suffix = s = uuid4().hex[:12]
        with self.admin.begin() as c:
            # The disposable database is shared by test methods; drain any
            # durable jobs so a worker never leases another test's project.
            c.execute(text("delete from project_verification_runs"))
        with self.admin.begin() as c:
            for name, role in (("stu", "candidate"), ("other", "candidate"),
                               ("rec", "recruiter"), ("rec2", "recruiter")):
                c.execute(text("insert into users(id,auth_user_id,email,role) values (:id,:id,:email,:role)"),
                          {"id": name + s, "email": name + s + "@example.invalid", "role": role})
            for name in ("stu", "other"):
                c.execute(text("insert into candidates(id,full_name) values (:id,:name)"),
                          {"id": "cand-" + name + s, "name": "Candidate " + name})
                c.execute(text("insert into candidate_owners(candidate_id,user_id) values (:cid,:uid)"),
                          {"cid": "cand-" + name + s, "uid": name + s})
            self.project = c.execute(text("insert into projects(candidate_id,name) values (:cid,'Owned project') returning id"),
                                     {"cid": "cand-stu" + s}).scalar_one()
            self.other_project = c.execute(text("insert into projects(candidate_id,name) values (:cid,'Other project') returning id"),
                                           {"cid": "cand-other" + s}).scalar_one()
            for wid, job, member in (("w" + s, "j" + s, "rec" + s), ("w2" + s, "j2" + s, "rec2" + s)):
                c.execute(text("insert into workspaces(id,name) values (:id,'Synthetic')"), {"id": wid})
                c.execute(text("insert into workspace_memberships(workspace_id,user_id,role) values (:w,:u,'recruiter')"),
                          {"w": wid, "u": member})
                c.execute(text("insert into jobs(id,title,status) values (:id,'Job','open')"), {"id": job})
                c.execute(text("insert into workspace_jobs(job_id,workspace_id) values (:j,:w)"), {"j": job, "w": wid})
            self.application = "a" + s
            c.execute(text("insert into applications(id,candidate_id,job_id) values (:id,:cid,:jid)"),
                      {"id": self.application, "cid": "cand-stu" + s, "jid": "j" + s})
        self.env = patch.dict(os.environ, {"V2_DATABASE_URL": APP, "VERIFICATION_ENABLED": "true",
                                           "VERIFICATION_WORKER_DATABASE_URL": WORKER})
        self.env.start()
        scoped_engine.cache_clear()
        self.worker = worker_engine()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        scoped_engine().dispose()
        scoped_engine.cache_clear()
        self.worker.dispose()
        self.env.stop()
        self.admin.dispose()

    def as_user(self, name):
        app.dependency_overrides[require_identity] = lambda: Identity(name + self.suffix)

    async def enqueue(self, claims=("React", "FastAPI", "Spring Boot"), project=None, url=None):
        self.as_user("stu")
        return await self.client.post(
            f"/api/v2/candidates/me/projects/{project or self.project}/verify",
            json={"repository_url": url or "https://github.com/example/project", "claims": list(claims)})

    def run_worker(self, transport=github_fixture):
        with httpx.Client(transport=httpx.MockTransport(transport)) as client:
            return process_one(self.worker, client)

    def run_status(self, run_id):
        with self.admin.connect() as c:
            return c.execute(text("select status,error_code,commit_sha from project_verification_runs where id=:id"),
                             {"id": run_id}).mappings().one()

    async def test_owner_workflow_evidence_and_recruiter_scope(self):
        response = await self.enqueue()
        self.assertEqual(response.status_code, 202, response.text)
        run_id = response.json()["run_id"]
        self.assertEqual(response.json()["status"], "pending")
        self.assertEqual(self.run_worker(), "processed")

        self.as_user("stu")
        latest = await self.client.get(
            f"/api/v2/candidates/me/projects/{self.project}/verification")
        self.assertEqual(latest.status_code, 200, latest.text)
        report = latest.json()
        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["project_name"], "Owned project")
        self.assertEqual(report["commit_sha"], SHA)
        self.assertEqual(report["repository_languages"], {"Python": 120, "TypeScript": 80})
        evidence = {item["claim"]: item for item in report["evidence"]}
        self.assertEqual(evidence["React"]["status"], "supporting")
        self.assertEqual(evidence["FastAPI"]["status"], "supporting")
        self.assertEqual(evidence["Spring Boot"]["status"], "not_established")
        self.assertTrue(evidence["FastAPI"]["source_url"].startswith(
            "https://github.com/example/project/blob/" + SHA + "/"))
        self.assertEqual(evidence["FastAPI"]["commit_sha"], SHA)
        single = (await self.client.get(
            f"/api/v2/candidates/me/projects/{self.project}/verification/{run_id}/evidence/"
            + evidence["FastAPI"]["id"])).json()
        self.assertEqual(single["file_path"], "app/main.py")
        self.assertNotIn("huge.py", {item["file_path"] for item in report["evidence"]})

        self.as_user("rec")
        recruiter = await self.client.get(
            f"/api/v2/recruiter/workspaces/w{self.suffix}/applications/{self.application}"
            f"/projects/{self.project}/verification/{run_id}")
        self.assertEqual(recruiter.status_code, 200, recruiter.text)
        self.assertEqual(recruiter.json()["commit_sha"], SHA)
        self.assertEqual(recruiter.json()["project_name"], "Owned project")
        self.assertNotIn("cand-stu", recruiter.text)
        self.assertNotIn("auth_user_id", recruiter.text)
        self.as_user("rec2")
        self.assertEqual((await self.client.get(
            f"/api/v2/recruiter/workspaces/w{self.suffix}/applications/{self.application}"
            f"/projects/{self.project}/verification/{run_id}")).status_code, 404)
        self.as_user("other")
        self.assertEqual((await self.client.get(
            f"/api/v2/candidates/me/projects/{self.project}/verification/{run_id}")).status_code, 404)
        self.as_user("stu")
        self.assertEqual((await self.client.get(
            f"/api/v2/candidates/me/projects/{self.other_project}/verification")).status_code, 404)

        with self.admin.connect() as c:
            actions = c.execute(text("select action from audit_logs where entity_id in (:pid,:run) and action like 'verification.%'"),
                                {"pid": str(self.project), "run": run_id}).scalars().all()
            self.assertIn("verification.request", actions)
            self.assertIn("verification.complete", actions)

    async def test_cross_student_invalid_urls_and_missing_auth(self):
        self.as_user("other")
        response = await self.client.post(
            f"/api/v2/candidates/me/projects/{self.project}/verify",
            json={"repository_url": "https://github.com/example/project", "claims": ["Python"]})
        self.assertEqual(response.status_code, 404)
        self.as_user("stu")
        for url in ("http://github.com/a/b", "https://github.com.evil/a/b",
                    "https://github.com/a/b?x=1", "https://user@github.com/a/b"):
            with self.subTest(url=url):
                self.assertEqual((await self.enqueue(url=url)).status_code, 422)
        self.assertEqual((await self.enqueue(claims=("Kubernetes",))).status_code, 422)
        app.dependency_overrides.clear()
        self.assertEqual((await self.client.post(
            f"/api/v2/candidates/me/projects/{self.project}/verify",
            json={"repository_url": "https://github.com/example/project", "claims": ["Python"]})).status_code, 401)
        with self.admin.connect() as c:
            self.assertEqual(c.execute(text("select count(*) from project_verification_runs r join projects p on p.id=r.project_id where p.candidate_id=:cid"),
                                       {"cid": "cand-stu" + self.suffix}).scalar_one(), 0)

    async def test_duplicate_concurrency_conflict_and_reverification(self):
        responses = await asyncio.gather(*[self.enqueue() for _ in range(3)])
        self.assertEqual([r.status_code for r in responses], [202, 202, 202])
        run_ids = {r.json()["run_id"] for r in responses}
        self.assertEqual(len(run_ids), 1)
        run_id = run_ids.pop()
        self.assertEqual((await self.enqueue(claims=("Python",))).status_code, 409)
        self.run_worker()
        self.assertEqual(self.run_status(run_id)["status"], "completed")
        reverified = await self.enqueue(claims=("Python",))
        self.assertEqual(reverified.status_code, 202, reverified.text)
        self.assertNotEqual(reverified.json()["run_id"], run_id)
        with self.admin.connect() as c:
            self.assertEqual(c.execute(text("select count(*) from project_verification_runs where project_id=:pid"),
                                       {"pid": self.project}).scalar_one(), 2)

    async def test_failures_retry_and_lease_recovery(self):
        run_id = (await self.enqueue(claims=("Python",))).json()["run_id"]
        for attempt in (1, 2, 3):
            self.assertEqual(self.run_worker(always(429)), "processed")
            with self.admin.begin() as c:
                c.execute(text("update verification_jobs set available_at=now() where run_id=:id"), {"id": run_id})
            row = self.run_status(run_id)
            self.assertEqual(row["status"], "unavailable" if attempt == 3 else "pending")
            self.assertEqual(row["error_code"], "rate_limited")
        self.assertEqual(self.run_worker(), "idle")
        with self.admin.connect() as c:
            self.assertEqual(c.execute(text("select count(*) from audit_logs where entity_id=:pid and action='verification.error'"),
                                       {"pid": str(self.project)}).scalar_one(), 3)
        fresh = (await self.enqueue(claims=("FastAPI",))).json()["run_id"]
        self.assertEqual(self.run_worker(always(404)), "processed")
        self.assertEqual(self.run_status(fresh)["status"], "unavailable")
        self.assertEqual(self.run_status(fresh)["error_code"], "not_found_or_inaccessible")

        expired = (await self.enqueue(claims=("React",))).json()["run_id"]
        with self.worker.begin() as c:
            self.assertEqual(c.execute(text("select count(*) from hp_claim_verification_job()")).scalar_one(), 1)
        with self.admin.begin() as c:
            c.execute(text("update verification_jobs set attempts=3, lease_until=now()-interval '1 second' where run_id=:id"),
                      {"id": expired})
        with self.worker.begin() as c:
            self.assertEqual(c.execute(text("select count(*) from hp_claim_verification_job()")).scalar_one(), 0)
        row = self.run_status(expired)
        self.assertEqual((row["status"], row["error_code"]), ("failed", "retry_exhausted"))
        with self.admin.connect() as c:
            self.assertEqual(c.execute(text("select count(*) from audit_logs where entity_id=:pid and action='verification.error' "
                                            "and metadata->>'error_code'='retry_exhausted'"),
                                       {"pid": str(self.project)}).scalar_one(), 1)
        self.assertEqual(self.run_worker(), "idle")

    async def test_worker_lease_tokens_and_forged_writes_are_denied(self):
        run_id = (await self.enqueue(claims=("FastAPI",))).json()["run_id"]
        with self.worker.begin() as c:
            job = c.execute(text("select * from hp_claim_verification_job()")).mappings().one()
            self.assertEqual(job["run_id"], run_id)
            claims = job["claims"]
            finding = [{"claim_id": claims[0]["id"], "status": "supporting",
                        "explanation": "A bounded file inspection found FastAPI.",
                        "source_url": "https://github.com/example/project/blob/" + SHA + "/app/main.py",
                        "file_path": "app/main.py"}]
            params = {"id": job["job_id"], "sha": SHA, "findings": json.dumps(finding),
                      "languages": json.dumps({"Python": 120, "TypeScript": 80})}
            self.assertFalse(c.execute(text("select hp_finish_verification_job(:id,'forged',:sha,cast(:findings as jsonb),cast(:languages as jsonb),null)"),
                                       params).scalar_one())
        with self.assertRaises(SQLAlchemyError):
            with self.worker.begin() as c:
                c.execute(text("select hp_finish_verification_job(:id,:token,:sha,cast(:findings as jsonb),cast(:languages as jsonb),null)"),
                          {**params, "token": job["lease_token"], "findings": json.dumps([
                              {**finding[0], "source_url": "https://evil.invalid/app/main.py"}])}).scalar_one()
        with self.assertRaises(SQLAlchemyError):
            with self.worker.begin() as c:
                c.execute(text("select hp_finish_verification_job(:id,:token,:sha,cast(:findings as jsonb),cast(:languages as jsonb),null)"),
                          {**params, "token": job["lease_token"], "findings": json.dumps([
                              {**finding[0], "file_path": "../secret.py",
                               "source_url": "https://github.com/example/project/blob/" + SHA + "/../secret.py"}])}).scalar_one()
        with self.worker.begin() as c:
            self.assertTrue(c.execute(text("select hp_finish_verification_job(:id,:token,:sha,cast(:findings as jsonb),cast(:languages as jsonb),null)"),
                                      {**params, "token": job["lease_token"]}).scalar_one())
            self.assertFalse(c.execute(text("select hp_finish_verification_job(:id,:token,:sha,cast(:findings as jsonb),cast(:languages as jsonb),null)"),
                                       {**params, "token": job["lease_token"]}).scalar_one())
        self.assertEqual(self.run_status(run_id)["status"], "completed")

        with self.assertRaises(SQLAlchemyError):
            with self.worker.begin() as c:
                c.execute(text("select * from verification_jobs")).all()
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as c:
                c.execute(text("select * from hp_claim_verification_job()")).all()
        with self.assertRaises(SQLAlchemyError):
            with self.worker.begin() as c:
                c.execute(text("select hp_enqueue_verification(:pid,'https://github.com/a/b',array['Python'])"),
                          {"pid": self.project}).all()
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as c:
                c.execute(text("insert into project_verification_evidence(id,run_id,project_id,claim_id,status,explanation) "
                               "values ('forged',:r,:p,'x','supporting','forged')"),
                          {"r": run_id, "p": self.project})
        with self.assertRaises(SQLAlchemyError):
            with scoped_engine().begin() as c:
                c.execute(text("update project_verification_runs set status='completed' where id=:id"), {"id": run_id})

    async def test_membership_revocation_applies_to_next_request(self):
        run_id = (await self.enqueue(claims=("React",))).json()["run_id"]
        self.run_worker()
        path = (f"/api/v2/recruiter/workspaces/w{self.suffix}/applications/{self.application}"
                f"/projects/{self.project}/verification/{run_id}")
        self.as_user("rec")
        self.assertEqual((await self.client.get(path)).status_code, 200)
        with self.admin.begin() as c:
            c.execute(text("delete from workspace_memberships where workspace_id=:w and user_id=:u"),
                      {"w": "w" + self.suffix, "u": "rec" + self.suffix})
        self.assertEqual((await self.client.get(path)).status_code, 404)
        self.as_user("stu")
        self.assertEqual((await self.client.get(
            f"/api/v2/candidates/me/projects/{self.project}/verification")).status_code, 200)

    async def test_feature_flag_is_fail_closed(self):
        with patch.dict(os.environ, {"VERIFICATION_ENABLED": "false"}):
            self.assertEqual((await self.enqueue()).status_code, 503)
        with patch.dict(os.environ, {"VERIFICATION_ENABLED": ""}):
            self.assertEqual((await self.enqueue()).status_code, 503)

    def create_second_project(self, name="Second owned project"):
        with self.admin.begin() as c:
            return c.execute(text(
                "insert into projects(candidate_id,name,ord) values (:cid,:name,1) returning id"
            ), {"cid": "cand-stu" + self.suffix, "name": name}).scalar_one()

    def set_policy(self, **values):
        assignments = ",".join(f"{key}=:{key}" for key in values)
        with self.admin.begin() as c:
            c.execute(text(
                f"update verification_policy set {assignments}, updated_at=now() where singleton"
            ), values)

    async def test_per_user_active_and_hourly_quotas(self):
        self.set_policy(max_active_per_user=1, max_requests_per_hour=2, max_requests_per_day=30)
        defaults = {"max_active_per_user": 2, "max_requests_per_hour": 10,
                    "max_requests_per_day": 30, "max_running_jobs": 4}
        try:
            first = await self.enqueue(claims=("Python",))
            self.assertEqual(first.status_code, 202, first.text)
            duplicate = await self.enqueue(claims=("Python",))
            self.assertEqual(duplicate.status_code, 202, duplicate.text)
            self.assertEqual(duplicate.json()["run_id"], first.json()["run_id"])

            metrics = collect_metrics(self.worker)
            self.assertEqual(metrics["queue_depth"], 1)
            self.assertEqual(metrics["pending_runs"], 1)
            self.assertEqual(metrics["policy"]["max_active_per_user"], 1)

            second_project = self.create_second_project()
            self.as_user("stu")
            blocked = await self.client.post(
                f"/api/v2/candidates/me/projects/{second_project}/verify",
                json={"repository_url": "https://github.com/example/second", "claims": ["React"]})
            self.assertEqual(blocked.status_code, 429, blocked.text)
            self.assertEqual(blocked.headers.get("retry-after"), "60")
            self.assertNotIn("verification quota exceeded", blocked.text)
            self.assertNotIn("cand-", blocked.text)

            self.assertEqual(self.run_worker(), "processed")
            second = await self.enqueue(claims=("FastAPI",))
            self.assertEqual(second.status_code, 202, second.text)
            self.assertEqual(self.run_worker(), "processed")
            hourly = await self.enqueue(claims=("TypeScript",))
            self.assertEqual(hourly.status_code, 429, hourly.text)
            self.assertEqual(hourly.headers.get("retry-after"), "3600")

            metrics = collect_metrics(self.worker)
            self.assertEqual(metrics["completed_last_24h"], 2)
            self.assertEqual(metrics["queue_depth"], 0)
            serialized = json.dumps(metrics)
            for private in ("example/project", "cand-", "example.invalid", "auth_user_id"):
                self.assertNotIn(private, serialized)
        finally:
            self.set_policy(**defaults)

    async def test_global_running_job_limit(self):
        self.set_policy(max_active_per_user=5, max_running_jobs=1)
        defaults = {"max_active_per_user": 2, "max_requests_per_hour": 10,
                    "max_requests_per_day": 30, "max_running_jobs": 4}
        try:
            second_project = self.create_second_project()
            self.as_user("stu")
            first = await self.enqueue(claims=("Python",))
            second = await self.client.post(
                f"/api/v2/candidates/me/projects/{second_project}/verify",
                json={"repository_url": "https://github.com/example/second", "claims": ["React"]})
            self.assertEqual(first.status_code, 202, first.text)
            self.assertEqual(second.status_code, 202, second.text)

            with self.worker.begin() as c:
                claimed = c.execute(text("select * from hp_claim_verification_job()")).mappings().first()
            self.assertIsNotNone(claimed)
            with self.worker.begin() as c:
                self.assertIsNone(c.execute(text("select * from hp_claim_verification_job()")).mappings().first())
            with self.admin.connect() as c:
                self.assertEqual(c.execute(text(
                    "select count(*) from project_verification_runs where status='running'"
                )).scalar_one(), 1)
        finally:
            self.set_policy(**defaults)
