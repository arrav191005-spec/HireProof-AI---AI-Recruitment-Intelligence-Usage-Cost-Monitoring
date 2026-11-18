import unittest

from httpx import ASGITransport, AsyncClient
from app.main import app


class VerificationAuthorizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_candidate_routes_fail_closed(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            for method, path in [
                ("POST", "/api/v2/projects"),
                ("POST", "/api/v2/projects/1/verify"),
                ("POST", "/api/v2/projects/1/reverify"),
                ("GET", "/api/v2/verification-runs/run"),
                ("GET", "/api/v2/verification-evidence/evidence"),
            ]:
                with self.subTest(path=path):
                    response = await client.request(method, path)
                    self.assertEqual(response.status_code, 503)
                    self.assertIn("disabled", response.json()["detail"])
