"""Opt-in real-GitHub worker/API workflow test on a disposable database.

This deliberately uses a synthetic *database fixture* identity, not a fake
Supabase login. Live Supabase/JWKS is covered separately by
test_live_supabase_optional.py. Set LIVE_GITHUB_WORKFLOW_TEST=1 only with the
restricted URLs for a disposable database named hireproof_rls_*.
"""
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from sqlalchemy import create_engine, text

from app.auth import Identity, require_identity
from app.github_verification import github_headers
from app.main import app
from app.scoped_db import scoped_engine
from app.verification_worker import github_token, process_one, worker_engine

LIVE = os.environ.get("LIVE_GITHUB_WORKFLOW_TEST") == "1"
ADMIN = os.environ.get("RLS_TEST_ADMIN_URL")
APP = os.environ.get("RLS_TEST_APP_URL")
WORKER = os.environ.get("VERIFICATION_TEST_WORKER_URL")


@unittest.skipUnless(LIVE and ADMIN and APP and WORKER,
                     "set LIVE_GITHUB_WORKFLOW_TEST=1 and disposable restricted DB URLs")
class LiveGithubWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if "hireproof_rls_" not in ADMIN:
            self.fail("the live GitHub workflow requires a disposable hireproof_rls_ database")
        self.suffix = uuid4().hex[:12]
        self.user = "live-gh-" + self.suffix
        self.candidate = "live-gh-candidate-" + self.suffix
        self.admin = create_engine(ADMIN)
        with self.admin.begin() as conn:
            conn.execute(text(
                "insert into users(id,auth_user_id,email,role) values (:id,:id,:email,'candidate')"
            ), {"id": self.user, "email": self.user + "@example.invalid"})
            conn.execute(text("insert into candidates(id,full_name) values (:id,'Live GitHub fixture')"),
                         {"id": self.candidate})
            conn.execute(text("insert into candidate_owners(candidate_id,user_id) values (:cid,:uid)"),
                         {"cid": self.candidate, "uid": self.user})
            self.project = conn.execute(text(
                "insert into projects(candidate_id,name) values (:cid,'Live GitHub verification fixture') returning id"
            ), {"cid": self.candidate}).scalar_one()
        self.env = {
            "V2_DATABASE_URL": APP,
            "VERIFICATION_WORKER_DATABASE_URL": WORKER,
            "VERIFICATION_ENABLED": "true",
        }
        self.env_patch = patch.dict(os.environ, self.env)
        self.env_patch.start()
        scoped_engine.cache_clear()
        self.worker = worker_engine()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        app.dependency_overrides[require_identity] = lambda: Identity(self.user)

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        self.worker.dispose()
        scoped_engine().dispose()
        scoped_engine.cache_clear()
        self.env_patch.stop()
        with self.admin.begin() as conn:
            # Evidence references both the run and claim. The existing schema
            # cascades a project to runs/claims but the composite claim FK
            # requires evidence to be removed first.
            conn.execute(text("delete from project_verification_evidence where project_id=:id"),
                         {"id": self.project})
            conn.execute(text("delete from projects where id=:id"), {"id": self.project})
            conn.execute(text("delete from candidate_owners where candidate_id=:id"), {"id": self.candidate})
            conn.execute(text("delete from candidates where id=:id"), {"id": self.candidate})
            conn.execute(text("delete from users where id=:id"), {"id": self.user})
        self.admin.dispose()

    async def test_public_repository_through_api_worker_and_report(self):
        queued = await self.client.post(
            f"/api/v2/candidates/me/projects/{self.project}/verify",
            json={
                "repository_url": "https://github.com/fastapi/full-stack-fastapi-template",
                "claims": ["Python", "FastAPI", "TypeScript", "React", "PostgreSQL"],
            },
        )
        self.assertEqual(queued.status_code, 202, queued.text)
        run_id = queued.json()["run_id"]

        # github_token() is server-side only; it is used if configured, else
        # the collector remains safely bounded under GitHub's anonymous limit.
        with httpx.Client(headers=github_headers(github_token())) as github:
            self.assertEqual(process_one(self.worker, github), "processed")

        report = await self.client.get(
            f"/api/v2/candidates/me/projects/{self.project}/verification/{run_id}")
        self.assertEqual(report.status_code, 200, report.text)
        payload = report.json()
        self.assertEqual(payload["status"], "completed")
        self.assertRegex(payload["commit_sha"], r"^[0-9a-f]{40}$")
        self.assertGreater(len(payload["repository_languages"]), 0)
        self.assertEqual(len(payload["evidence"]), 5)
        self.assertTrue(any(item["status"] == "supporting" for item in payload["evidence"]))
        self.assertTrue(all(item["commit_sha"] in (None, payload["commit_sha"])
                            for item in payload["evidence"]))
