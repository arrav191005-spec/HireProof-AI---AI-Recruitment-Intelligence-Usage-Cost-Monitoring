"""Opt-in, rollback-only migration/persistence tests against a disposable DB."""
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db import get_engine
from app.github_verification import Finding
from app.verification_store import save_completed_run


@unittest.skipUnless(os.environ.get("VERIFICATION_TEST_DATABASE_URL"),
                     "set VERIFICATION_TEST_DATABASE_URL to a disposable migrated database")
class VerificationPersistenceTests(unittest.TestCase):
    def test_run_and_evidence_persist_and_reverification_creates_new_run(self):
        with patch.dict(os.environ, {"DATABASE_URL": os.environ["VERIFICATION_TEST_DATABASE_URL"]}):
            get_engine.cache_clear()
            engine = get_engine()
            suffix = uuid4().hex
            # One outer transaction rolls back all fixtures, including sequence ownership.
            try:
                with engine.connect() as conn:
                    trans = conn.begin()
                    try:
                        candidate = "test-" + suffix
                        conn.execute(text("insert into candidates (id, full_name) values (:id, 'Synthetic')"), {"id": candidate})
                        project = conn.execute(text("insert into projects (candidate_id, name) values (:id, 'Synthetic') returning id"), {"id": candidate}).scalar_one()
                        conn.execute(text("insert into project_repository_refs (id, project_id, repository_url) values ('ref', :p, 'https://github.com/a/b')"), {"p": project})
                        conn.execute(text("insert into project_claims (id, project_id, claim_text) values ('claim', :p, 'Python')"), {"p": project})
                        with Session(bind=conn) as session:
                            finding = Finding("Python", "supporting", "Source file found.",
                                              "https://github.com/a/b/blob/" + "a"*40 + "/main.py", "main.py", "a"*40)
                            first = save_completed_run(session, project, "ref", "a"*40, [("claim", finding)])
                            second = save_completed_run(session, project, "ref", "a"*40, [("claim", finding)])
                            self.assertNotEqual(first, second)
                            self.assertEqual(conn.execute(text("select count(*) from project_verification_evidence where run_id in (:a, :b)"), {"a": first, "b": second}).scalar_one(), 2)
                    finally:
                        trans.rollback()
            finally:
                engine.dispose()
                get_engine.cache_clear()
