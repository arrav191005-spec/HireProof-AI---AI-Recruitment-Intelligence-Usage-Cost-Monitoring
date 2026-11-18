import asyncio
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.auth import Identity, require_identity
from app.main import app
from app.provider_identity import confirmed_email
from app.scoped_db import scoped_engine


class ProviderIdentityTests(unittest.TestCase):
    def test_provider_requires_matching_subject_and_confirmed_email(self):
        original_client = httpx.Client
        for payload, expected in [
            ({"id": "subject", "email": "a@example.invalid", "email_confirmed_at": "2026-01-01"}, True),
            ({"id": "other", "email": "a@example.invalid", "email_confirmed_at": "2026-01-01"}, False),
            ({"id": "subject", "email": "a@example.invalid", "email_confirmed_at": None}, False),
        ]:
            with self.subTest(payload=payload), patch.dict(os.environ, {
                "SUPABASE_AUTH_ISSUER": "https://example.supabase.co/auth/v1",
                "SUPABASE_JWT_AUDIENCE": "authenticated",
                "SUPABASE_PUBLISHABLE_KEY": "test-publishable",
            }), patch("app.provider_identity.httpx.Client", side_effect=lambda **kw: original_client(
                transport=httpx.MockTransport(lambda req: httpx.Response(200, json=payload)), **kw
            )):
                if expected:
                    self.assertEqual(confirmed_email(Identity("subject"), "test-token"), "a@example.invalid")
                else:
                    with self.assertRaises(HTTPException) as error:
                        confirmed_email(Identity("subject"), "test-token")
                    self.assertEqual(error.exception.status_code, 403)


ADMIN = os.environ.get("RLS_TEST_ADMIN_URL")
APP = os.environ.get("RLS_TEST_APP_URL")


@unittest.skipUnless(ADMIN and APP, "requires disposable PostgreSQL and restricted login")
class StudentIdentityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not make_url(ADMIN).database.startswith("hireproof_rls_"):
            self.fail("test database must start with hireproof_rls_")
        self.admin = create_engine(ADMIN)
        self.suffix = uuid4().hex[:12]
        self.env = patch.dict(os.environ, {"V2_DATABASE_URL": APP})
        self.env.start()
        scoped_engine.cache_clear()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                        headers={"Authorization": "Bearer synthetic"})
        app.dependency_overrides[require_identity] = lambda: Identity("subject"+self.suffix)

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        scoped_engine().dispose()
        scoped_engine.cache_clear()
        self.env.stop()
        self.admin.dispose()

    async def test_idempotency_conflict_and_no_claim_of_existing_profiles(self):
        email = self.suffix+"@example.invalid"
        with patch("app.api.scoped.confirmed_email", return_value=email):
            responses = await asyncio.gather(*[self.client.post("/api/v2/accounts/student") for _ in range(4)])
        self.assertEqual([r.status_code for r in responses], [200]*4)
        self.assertEqual(len({r.json()["user_id"] for r in responses}), 1)
        with self.admin.connect() as c:
            self.assertEqual(c.execute(text("select count(*) from candidate_owners o join users u on u.id=o.user_id where u.auth_user_id=:s"),
                                       {"s": "subject"+self.suffix}).scalar_one(), 0)
            self.assertEqual(c.execute(text("select count(*) from audit_logs where action='identity.student.create' and actor=:id"),
                                       {"id": responses[0].json()["user_id"]}).scalar_one(), 1)
        app.dependency_overrides[require_identity] = lambda: Identity("other"+self.suffix)
        with patch("app.api.scoped.confirmed_email", return_value=email.upper()):
            self.assertEqual((await self.client.post("/api/v2/accounts/student")).status_code, 409)
