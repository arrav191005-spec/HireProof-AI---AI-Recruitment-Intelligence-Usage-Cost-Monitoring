"""API-level checks for the V2 boundary and legacy compatibility."""

import unittest

from httpx import ASGITransport, AsyncClient

from app.main import app


class V2HealthTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_v2_health_is_liveness_only(self):
        response = await self.client.get("/api/v2/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(set(body), {"status", "service", "version"})

    async def test_legacy_health_remains_available(self):
        response = await self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    async def test_unknown_v2_route_returns_json_404(self):
        response = await self.client.get("/api/v2/not-a-route")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Not Found"})


if __name__ == "__main__":
    unittest.main()
