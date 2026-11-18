import base64
import unittest
from unittest.mock import patch

import httpx

from app.github_verification import (GitHubCollector, VerificationUnavailable,
                                     evaluate_claims, normalize_repository_url)

SHA = "a" * 40


def fixture_response(request):
    path = request.url.path
    if path == "/repos/example/project":
        return httpx.Response(200, json={"private": False, "default_branch": "main"})
    if path.endswith("/commits/main"):
        return httpx.Response(200, json={"sha": SHA})
    if path.endswith("/languages"):
        return httpx.Response(200, json={"Python": 123})
    if "/git/trees/" in path:
        return httpx.Response(200, json={"tree": [
            {"type": "blob", "path": "README.md", "size": 10},
            {"type": "blob", "path": "app/main.py", "size": 40},
            {"type": "blob", "path": "package.json", "size": 30},
        ], "truncated": False})
    if "/contents/" in path:
        content = (b'{"dependencies":{"react":"1"}}' if path.endswith("package.json")
                   else b"from fastapi import FastAPI" if path.endswith(".py") else b"Java Spring Boot")
        return httpx.Response(200, json={"encoding": "base64", "content": base64.b64encode(content).decode()})
    return httpx.Response(404)


class GithubTests(unittest.TestCase):
    def test_url_validation(self):
        self.assertEqual(normalize_repository_url("https://github.com/example/project.git")[2],
                         "https://github.com/example/project")
        for value in ["http://github.com/a/b", "https://github.com.evil/a/b",
                      "https://github.com/a/b/extra", "https://github.com/a/%2e%2e",
                      "https://user@github.com/a/b", "https://github.com/a/b?x=1"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_repository_url(value)

    def test_collection_and_grounded_findings(self):
        with httpx.Client(transport=httpx.MockTransport(fixture_response)) as client:
            snapshot = GitHubCollector(client).collect("https://github.com/example/project")
        results = evaluate_claims(snapshot, ["React", "FastAPI", "Python", "Spring Boot", "invented feature"])
        self.assertEqual([f.status for f in results], ["supporting", "supporting", "supporting", "not_established", "needs_review"])
        self.assertTrue(all(f.source_url and SHA in f.source_url for f in results[:3]))
        self.assertIsNone(results[3].source_url)

    def test_unavailable_and_rate_limit(self):
        for status, headers, code in [(404, {}, "not_found_or_inaccessible"),
                                       (403, {}, "inaccessible"),
                                       (403, {"x-ratelimit-remaining": "0"}, "rate_limited"),
                                       (429, {}, "rate_limited"), (302, {}, "github_unavailable")]:
            with self.subTest(status=status, code=code):
                with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status, headers=headers))) as client:
                    with self.assertRaises(VerificationUnavailable) as caught:
                        GitHubCollector(client).collect("https://github.com/example/project")
                    self.assertEqual(caught.exception.code, code)

    def test_request_budget(self):
        with httpx.Client(transport=httpx.MockTransport(fixture_response)) as client:
            collector = GitHubCollector(client)
            collector.requests = 12
            with self.assertRaises(VerificationUnavailable):
                collector.collect("https://github.com/example/project")

    def test_private_deleted_and_oversized_content_are_not_collected(self):
        def private(request):
            return httpx.Response(200, json={"private": True, "default_branch": "main"})

        def oversized(request):
            if "/contents/" in request.url.path:
                return httpx.Response(200, json={"encoding": "base64", "content": ""})
            if "/git/trees/" in request.url.path:
                return httpx.Response(200, json={"tree": [
                    {"type": "blob", "path": "huge.ts", "size": 65_000},
                    {"type": "blob", "path": "small.ts", "size": 30},
                ], "truncated": False})
            return fixture_response(request)

        with httpx.Client(transport=httpx.MockTransport(private)) as client:
            with self.assertRaises(VerificationUnavailable) as caught:
                GitHubCollector(client).collect("https://github.com/example/project")
            self.assertEqual(caught.exception.code, "inaccessible")
        with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404))) as client:
            with self.assertRaises(VerificationUnavailable) as caught:
                GitHubCollector(client).collect("https://github.com/example/project")
            self.assertEqual(caught.exception.code, "not_found_or_inaccessible")
        with httpx.Client(transport=httpx.MockTransport(oversized)) as client:
            snapshot = GitHubCollector(client).collect("https://github.com/example/project")
        self.assertEqual([f["path"] for f in snapshot["files"]], ["small.ts"])
        self.assertTrue(snapshot["files"][0]["url"].endswith("/blob/" + SHA + "/small.ts"))
