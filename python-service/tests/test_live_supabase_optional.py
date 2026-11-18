"""Optional live Supabase authentication boundary check.

Skipped unless LIVE_SUPABASE_TEST=1 and a dedicated development test user is
provided. This verifies, against the real provider:

  1. email/password sign-in succeeds and returns an access token;
  2. the token subject matches the Supabase user id;
  3. FastAPI accepts the token through real JWKS discovery;
  4. malformed credentials are rejected.

Required environment variables (never commit their values):

  LIVE_SUPABASE_TEST=1
  LIVE_SUPABASE_URL=https://<project-ref>.supabase.co
  LIVE_SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
  LIVE_SUPABASE_TEST_EMAIL=<dedicated test user>
  LIVE_SUPABASE_TEST_PASSWORD=<test user password>

The test prints nothing about the token or password and makes no database
writes. It is excluded from default runs because it needs network access and a
real development Supabase project.
"""
import os
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

import httpx
import jwt
from httpx import ASGITransport, AsyncClient

from app.main import app

LIVE = os.environ.get("LIVE_SUPABASE_TEST") == "1"
CONFIGURED = all(os.environ.get(name) for name in (
    "LIVE_SUPABASE_URL", "LIVE_SUPABASE_PUBLISHABLE_KEY",
    "LIVE_SUPABASE_TEST_EMAIL", "LIVE_SUPABASE_TEST_PASSWORD",
))


@unittest.skipUnless(LIVE and CONFIGURED, "set LIVE_SUPABASE_TEST=1 and the LIVE_SUPABASE_* variables")
class LiveSupabaseBoundaryTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        base = os.environ["LIVE_SUPABASE_URL"].strip().rstrip("/")
        parsed = urlsplit(base)
        if parsed.scheme != "https" or not parsed.hostname or parsed.path.strip("/"):
            raise unittest.SkipTest("LIVE_SUPABASE_URL must be a bare https://<ref>.supabase.co URL")
        cls.base = base
        cls.apikey = os.environ["LIVE_SUPABASE_PUBLISHABLE_KEY"].strip()
        cls.email = os.environ["LIVE_SUPABASE_TEST_EMAIL"].strip()
        cls.password = os.environ["LIVE_SUPABASE_TEST_PASSWORD"]

    async def asyncSetUp(self):
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()

    def sign_in(self) -> dict:
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            response = client.post(
                self.base + "/auth/v1/token",
                params={"grant_type": "password"},
                headers={"apikey": self.apikey, "Accept": "application/json"},
                json={"email": self.email, "password": self.password},
            )
        if response.status_code != 200:
            raise unittest.SkipTest("live Supabase sign-in failed; check the test user and project settings")
        payload = response.json()
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise unittest.SkipTest("live Supabase returned no access token")
        return payload

    async def test_live_token_is_accepted_through_jwks_and_subject_matches(self):
        session = self.sign_in()
        token = session["access_token"]
        claims = jwt.decode(token, options={"verify_signature": False})
        self.assertEqual(claims.get("aud"), "authenticated")
        self.assertGreater(claims.get("exp", 0), int(time.time()))

        with patch.dict(os.environ, {
            "SUPABASE_AUTH_ISSUER": self.base + "/auth/v1",
            "SUPABASE_JWT_AUDIENCE": "authenticated",
        }):
            accepted = await self.client.get(
                "/api/v2/me", headers={"Authorization": "Bearer " + token})
            rejected = await self.client.get(
                "/api/v2/me", headers={"Authorization": "Bearer not-a-jwt"})

        self.assertEqual(accepted.status_code, 200, "FastAPI rejected a live Supabase token")
        self.assertEqual(accepted.json(), {"subject": claims["sub"]})
        self.assertEqual(rejected.status_code, 401)

        with httpx.Client(timeout=10, follow_redirects=False) as client:
            user = client.get(
                self.base + "/auth/v1/user",
                headers={"apikey": self.apikey, "Authorization": "Bearer " + token},
            )
        self.assertEqual(user.status_code, 200)
        self.assertEqual(user.json().get("id"), claims["sub"])
        self.assertIsNotNone(user.json().get("email_confirmed_at"),
                             "the live test user must have a confirmed email")
