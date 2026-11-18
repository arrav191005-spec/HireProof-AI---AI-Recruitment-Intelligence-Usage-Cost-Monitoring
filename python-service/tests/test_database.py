"""Database tests. PostgreSQL writes require an explicit TEST_DATABASE_URL."""
import os
import unittest
import uuid
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import DatabaseNotConfigured, get_engine
from app.main import app
from app.models import Job


class ConnectionConfigTests(unittest.TestCase):
    def tearDown(self):
        get_engine.cache_clear()

    def test_missing_url_fails_closed(self):
        with patch.dict(os.environ, {"DATABASE_URL": ""}):
            get_engine.cache_clear()
            with self.assertRaises(DatabaseNotConfigured):
                get_engine()

    def test_non_postgresql_url_is_rejected(self):
        with patch.dict(os.environ, {"DATABASE_URL": "sqlite://"}):
            get_engine.cache_clear()
            with self.assertRaises(DatabaseNotConfigured):
                get_engine()


class ApiDatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Only an isolated in-memory test table, never application metadata.
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE jobs (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL)"))
        self.patcher = patch("app.api.v2.get_engine", return_value=self.engine)
        self.patcher.start()
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.patcher.stop()
        self.engine.dispose()

    async def test_crud_and_open_job_listing(self):
        with Session(self.engine) as session:
            session.add_all([Job(id="open-1", title="Engineer", status="open"),
                             Job(id="draft-1", title="Draft", status="draft")])
            session.commit()
        self.assertEqual((await self.client.get("/api/v2/ready")).status_code, 200)
        response = await self.client.get("/api/v2/jobs")
        self.assertEqual(response.json(), [{"id": "open-1", "title": "Engineer"}])
        with Session(self.engine) as session:
            job = session.get(Job, "open-1")
            job.title = "Updated"
            session.commit()
        self.assertEqual((await self.client.get("/api/v2/jobs")).json()[0]["title"], "Updated")
        with Session(self.engine) as session:
            session.delete(session.get(Job, "open-1"))
            session.commit()
        self.assertEqual((await self.client.get("/api/v2/jobs")).json(), [])

    async def test_unavailable_database_is_sanitized(self):
        with patch("app.api.v2.get_engine", side_effect=DatabaseNotConfigured):
            for path in ("/api/v2/ready", "/api/v2/jobs"):
                response = await self.client.get(path)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {"detail": "Database unavailable or schema not ready."})


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "set TEST_DATABASE_URL for PostgreSQL integration")
class PostgresPersistenceTests(unittest.TestCase):
    def test_commit_read_update_delete_across_connections(self):
        # A unique test-owned row only. Never seed, migrate, reset, or touch other rows.
        with patch.dict(os.environ, {"DATABASE_URL": os.environ["TEST_DATABASE_URL"]}):
            get_engine.cache_clear()
            engine = get_engine()
            job_id = "test-python-" + uuid.uuid4().hex
            try:
                with Session(engine) as session:
                    session.add(Job(id=job_id, title="Synthetic integration test", status="draft"))
                    session.commit()
                with Session(engine) as session:
                    job = session.scalar(select(Job).where(Job.id == job_id))
                    self.assertIsNotNone(job)
                    self.assertEqual(job.title, "Synthetic integration test")
                    job.title = "Updated synthetic test"
                    session.commit()
                with Session(engine) as session:
                    job = session.get(Job, job_id)
                    self.assertEqual(job.title, "Updated synthetic test")
                    session.delete(job)
                    session.commit()
                with Session(engine) as session:
                    self.assertIsNone(session.get(Job, job_id))
            finally:
                with Session(engine) as session:
                    job = session.get(Job, job_id)
                    if job is not None:
                        session.delete(job)
                        session.commit()
                engine.dispose()
                get_engine.cache_clear()


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "set TEST_DATABASE_URL for PostgreSQL integration")
class PostgresApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_readiness_and_jobs_against_postgres(self):
        with patch.dict(os.environ, {"DATABASE_URL": os.environ["TEST_DATABASE_URL"]}):
            get_engine.cache_clear()
            try:
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                    ready = await client.get("/api/v2/ready")
                    self.assertEqual(ready.status_code, 200)
                    self.assertEqual(ready.json()["database"], "ready")
                    jobs = await client.get("/api/v2/jobs")
                    self.assertEqual(jobs.status_code, 200)
                    self.assertIsInstance(jobs.json(), list)
                    for job in jobs.json():
                        self.assertEqual(set(job), {"id", "title"})
            finally:
                get_engine().dispose()
                get_engine.cache_clear()
