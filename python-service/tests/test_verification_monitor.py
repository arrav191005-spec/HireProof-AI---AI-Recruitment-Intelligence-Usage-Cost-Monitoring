"""Sanitized monitoring CLI against the restricted worker login."""
import contextlib
import io
import json
import os
import unittest
from unittest.mock import patch

from app.verification_monitor import main as monitor_main

WORKER = os.environ.get("VERIFICATION_TEST_WORKER_URL")


@unittest.skipUnless(WORKER, "requires a restricted verification-worker login")
class VerificationMonitorCliTests(unittest.TestCase):
    def test_json_output_contains_only_aggregate_metrics(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"VERIFICATION_MONITOR_DATABASE_URL": WORKER}):
            with contextlib.redirect_stdout(output):
                code = monitor_main(["--json"])
        self.assertEqual(code, 0, output.getvalue())
        metrics = json.loads(output.getvalue())
        self.assertIn("queue_depth", metrics)
        self.assertIn("pending_runs", metrics)
        self.assertIn("running_runs", metrics)
        self.assertIn("completed_last_24h", metrics)
        self.assertIn("failed_last_24h", metrics)
        self.assertIn("rate_limited_last_24h", metrics)
        self.assertIn("average_duration_seconds_last_24h", metrics)
        self.assertIn("policy", metrics)
        self.assertIsInstance(metrics["queue_depth"], int)
        serialized = json.dumps(metrics)
        for private in ("repository_url", "candidate", "cand-", "auth_user_id", "GITHUB_TOKEN"):
            self.assertNotIn(private, serialized)

    def test_monitor_fails_closed_without_configuration(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"VERIFICATION_MONITOR_DATABASE_URL": "",
                                     "VERIFICATION_WORKER_DATABASE_URL": ""}):
            with contextlib.redirect_stdout(output):
                self.assertEqual(monitor_main([]), 1)
        self.assertEqual(output.getvalue().strip(), "Verification monitoring unavailable.")
