import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient
from jwt.exceptions import PyJWKClientConnectionError

from app.main import app

ISSUER = "https://example.supabase.co/auth/v1"
AUDIENCE = "authenticated"


class AuthenticationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    async def asyncSetUp(self):
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        self.environment = patch.dict("os.environ", {
            "SUPABASE_AUTH_ISSUER": ISSUER, "SUPABASE_JWT_AUDIENCE": AUDIENCE
        })
        self.environment.start()
        self.key_client = patch("app.auth.jwks_client", return_value=SimpleNamespace(
            get_signing_key_from_jwt=lambda token: SimpleNamespace(key=self.private_key.public_key())
        ))
        self.key_client.start()

    async def asyncTearDown(self):
        await self.client.aclose()
        self.key_client.stop()
        self.environment.stop()

    def token(self, *, key=None, **overrides):
        claims = {"iss": ISSUER, "aud": AUDIENCE, "sub": "student-1",
                  "exp": int(time.time()) + 60}
        claims.update(overrides)
        return jwt.encode(claims, key or self.private_key, algorithm="RS256", headers={"kid": "test"})

    async def request(self, token=None):
        return await self.client.get("/api/v2/me",
                                     headers={"Authorization": f"Bearer {token}"} if token else {})

    async def test_valid_signature_returns_only_subject_not_client_role(self):
        response = await self.request(self.token(role="admin"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"subject": "student-1"})

    async def test_invalid_and_expired_tokens_are_denied(self):
        for token in [self.token(exp=int(time.time()) - 10),
                      self.token(key=self.other_key), self.token(aud="wrong"),
                      self.token(iss="https://attacker.example"), "not-a-jwt",
                      jwt.encode({"sub": "student-1"}, "not-a-real-key-" * 4, algorithm="HS256")]:
            with self.subTest(token_type=token[:12]):
                self.assertEqual((await self.request(token)).status_code, 401)
        self.assertEqual((await self.request()).status_code, 401)

    async def test_missing_config_and_unavailable_key_service_fail_closed(self):
        with patch.dict("os.environ", {"SUPABASE_AUTH_ISSUER": ""}):
            self.assertEqual((await self.request(self.token())).status_code, 503)
        with patch("app.auth.jwks_client", return_value=SimpleNamespace(
            get_signing_key_from_jwt=lambda token: (_ for _ in ()).throw(PyJWKClientConnectionError("offline"))
        )):
            self.assertEqual((await self.request(self.token())).status_code, 503)
