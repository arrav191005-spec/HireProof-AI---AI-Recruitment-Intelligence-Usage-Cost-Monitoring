"""Checks the ownership foundation without authorizing private API access."""
import os
import unittest
from unittest.mock import patch

from sqlalchemy import text

from app.db import get_engine


@unittest.skipUnless(os.environ.get("VERIFICATION_TEST_DATABASE_URL"), "requires disposable migrated PostgreSQL")
class WorkspaceSchemaTests(unittest.TestCase):
    def test_rls_and_public_roles_denied(self):
        with patch.dict(os.environ, {"DATABASE_URL": os.environ["VERIFICATION_TEST_DATABASE_URL"]}):
            get_engine.cache_clear()
            engine = get_engine()
            try:
                with engine.connect() as conn:
                    for table in ("candidate_owners", "workspaces", "workspace_memberships", "workspace_jobs"):
                        row = conn.execute(text(
                            "select c.relrowsecurity, has_table_privilege('anon', c.oid, 'SELECT'), "
                            "has_table_privilege('authenticated', c.oid, 'SELECT') "
                            "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                            "where n.nspname='public' and c.relname=:name"
                        ), {"name": table}).one()
                        self.assertEqual(tuple(row), (True, False, False), table)
            finally:
                engine.dispose()
                get_engine.cache_clear()
