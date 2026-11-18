"""Optional read-only live GitHub integration check.

Set LIVE_GITHUB_TEST=1 to run. This is excluded from default CI because it
depends on public network access and GitHub's shared anonymous rate limit.
"""
import os
import unittest

import httpx

from app.github_verification import GitHubCollector

LIVE = os.environ.get("LIVE_GITHUB_TEST") == "1"


@unittest.skipUnless(LIVE, "set LIVE_GITHUB_TEST=1 to run a real public GitHub check")
class LiveGithubTests(unittest.TestCase):
    def test_public_repository_snapshot_is_bounded_and_commit_pinned(self):
        with httpx.Client(headers={
            "User-Agent": "HireProof-AI-Verification",
            "Accept": "application/vnd.github+json",
        }) as client:
            snapshot = GitHubCollector(client).collect("https://github.com/psf/requests")
        self.assertRegex(snapshot["commit_sha"], r"^[0-9a-f]{40}$")
        self.assertGreaterEqual(len(snapshot["files"]), 1)
        self.assertLessEqual(len(snapshot["files"]), 8)
        for file in snapshot["files"]:
            self.assertEqual(file["url"],
                             "https://github.com/psf/requests/blob/"
                             + snapshot["commit_sha"] + "/" + file["path"])
