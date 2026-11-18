"""Scoped persistence tests for consented resume intelligence using fixtures."""
import json
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.ai_provider import FixtureAIProvider
from app.auth import Identity, require_identity
from app.main import app
from app.scoped_db import scoped_engine

ADMIN = os.environ.get("RLS_TEST_ADMIN_URL")
APP = os.environ.get("RLS_TEST_APP_URL")

EXCERPT = "Shop Stack — Built a React storefront with FastAPI and PostgreSQL authentication."
PAYLOAD = {
    "summary": "Technical project resume.",
    "skills": ["React", "FastAPI", "PostgreSQL"],
    "projects": [{
        "name": "Shop Stack", "description": "A web storefront.",
        "claimed_languages": ["TypeScript"], "claimed_frameworks": ["React", "FastAPI"],
        "claimed_databases": ["PostgreSQL"],
        "github_url": "https://github.com/example/shop-stack", "deployed_url": None,
        "source_excerpt": EXCERPT,
    }],
    "claims": [
        {"project_name": "Shop Stack", "claim_text": "React", "category": "framework",
         "source_excerpt": EXCERPT},
    ],
    "certificates": [],
}


@unittest.skipUnless(ADMIN and APP, "requires disposable restricted API database URLs")
class ResumeIntelligenceApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not make_url(ADMIN).database.startswith("hireproof_rls_"):
            self.fail("test database must start with hireproof_rls_")
        self.admin = create_engine(ADMIN)
        self.suffix = uuid4().hex[:12]
        self.user, self.other = "ai-" + self.suffix, "ai-other-" + self.suffix
        self.candidate = "ai-candidate-" + self.suffix
        with self.admin.begin() as conn:
            for user in (self.user, self.other):
                conn.execute(text(
                    "insert into users(id,auth_user_id,email,role) values (:id,:id,:email,'candidate')"
                ), {"id": user, "email": user + "@example.invalid"})
            conn.execute(text("insert into candidates(id,full_name) values (:id,'AI fixture')"),
                         {"id": self.candidate})
            conn.execute(text("insert into candidate_owners(candidate_id,user_id) values (:cid,:uid)"),
                         {"cid": self.candidate, "uid": self.user})
            self.resume = "resume-" + self.suffix
            conn.execute(text("""
                insert into resumes(id,candidate_id,filename,status,sections,full_text)
                values (:id,:cid,'fixture.pdf','processed',cast(:sections as jsonb),:body)
            """), {"id": self.resume, "cid": self.candidate,
                   "sections": json.dumps([{"page": 1, "text": EXCERPT}]),
                   "body": "Ada Example\n" + EXCERPT + "\nhttps://github.com/example/shop-stack"})
            self.project = conn.execute(text(
                "insert into projects(candidate_id,name,summary) values (:cid,'Shop Stack','fixture') returning id"
            ), {"cid": self.candidate}).scalar_one()
            self.job = "job-" + self.suffix
            conn.execute(text("insert into jobs(id,title,status) values (:id,'React developer','open')"),
                         {"id": self.job})
            conn.execute(text("insert into job_requirements(job_id,skill,category) values (:job,'React','required')"),
                         {"job": self.job})
            conn.execute(text("insert into applications(id,candidate_id,job_id) values (:id,:cid,:job)"),
                         {"id": "app-" + self.suffix, "cid": self.candidate, "job": self.job})
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
        with self.admin.begin() as conn:
            conn.execute(text("delete from project_verification_evidence where project_id=:id"), {"id": self.project})
            conn.execute(text("delete from projects where id=:id"), {"id": self.project})
            conn.execute(text("delete from applications where candidate_id=:id"), {"id": self.candidate})
            conn.execute(text("delete from resumes where id=:id"), {"id": self.resume})
            conn.execute(text("delete from candidate_owners where candidate_id=:id"), {"id": self.candidate})
            conn.execute(text("delete from candidates where id=:id"), {"id": self.candidate})
            conn.execute(text("delete from users where id in (:one,:two)"), {"one": self.user, "two": self.other})
            conn.execute(text("delete from jobs where id=:id"), {"id": self.job})
        self.admin.dispose()

    def as_subject(self, subject):
        app.dependency_overrides[require_identity] = lambda: Identity(subject)

    async def test_consent_grounding_usage_and_cross_student_denial(self):
        self.as_subject(self.user)
        denied = await self.client.post("/api/v2/candidates/me/resume-intelligence",
                                        json={"resume_id": self.resume, "consent_to_external_ai": False})
        self.assertEqual(denied.status_code, 422)
        with patch("app.api.resume_intelligence.get_ai_provider",
                   return_value=FixtureAIProvider(PAYLOAD)):
            response = await self.client.post("/api/v2/candidates/me/resume-intelligence", json={
                "resume_id": self.resume, "consent_to_external_ai": True, "job_id": self.job,
            })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["claims"][0]["classification"], "needs_review")
        self.assertEqual(body["ats"]["covered_requirements"], ["React"])
        with self.admin.connect() as conn:
            self.assertEqual(conn.execute(text(
                "select count(*) from ai_request_usage where analysis_run_id=:id"
            ), {"id": body["run_id"]}).scalar_one(), 1)
            self.assertEqual(conn.execute(text(
                "select count(*) from resume_project_claims where analysis_run_id=:id"
            ), {"id": body["run_id"]}).scalar_one(), 1)
        self.as_subject(self.other)
        self.assertEqual((await self.client.get(
            "/api/v2/candidates/me/resume-intelligence/" + body["run_id"])).status_code, 404)
