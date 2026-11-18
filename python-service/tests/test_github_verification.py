import base64
import os
import unittest
from unittest.mock import patch

import httpx

from app.github_verification import (GitHubCollector, VerificationUnavailable,
                                     bounded_languages, evaluate_claims, github_headers,
                                     normalize_repository_url, select_candidate_paths)
from app.verification_worker import WorkerConfigurationError, github_token

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

    def test_optional_server_side_token_headers(self):
        anonymous = github_headers()
        self.assertNotIn("Authorization", anonymous)
        self.assertEqual(anonymous["Accept"], "application/vnd.github+json")
        self.assertEqual(anonymous["X-GitHub-Api-Version"], "2022-11-28")
        authenticated = github_headers("ghp_example_token")
        self.assertEqual(authenticated["Authorization"], "Bearer ghp_example_token")
        with patch.dict(os.environ, {"GITHUB_TOKEN": ""}):
            self.assertIsNone(github_token())
        with patch.dict(os.environ, {"GITHUB_TOKEN": "ghp_example_token"}):
            self.assertEqual(github_token(), "ghp_example_token")
        for invalid in ("two words", "line\nbreak", "x" * 256):
            with self.subTest(invalid=invalid[:12]), patch.dict(os.environ, {"GITHUB_TOKEN": invalid}):
                with self.assertRaises(WorkerConfigurationError):
                    github_token()

    def test_collection_and_grounded_findings(self):
        with httpx.Client(transport=httpx.MockTransport(fixture_response)) as client:
            snapshot = GitHubCollector(client).collect("https://github.com/example/project")
        results = evaluate_claims(snapshot, ["React", "FastAPI", "Python", "Spring Boot", "invented feature"])
        self.assertEqual([f.status for f in results], ["supporting", "supporting", "supporting", "not_established", "needs_review"])
        self.assertTrue(all(f.source_url and SHA in f.source_url for f in results[:3]))
        self.assertIsNone(results[3].source_url)
        self.assertEqual(snapshot["languages"], {"Python": 123})

    def test_language_metadata_is_bounded_and_sanitized(self):
        clean = bounded_languages({
            "Python": 120, "TypeScript": 80, "Empty": 0, "Float": 7.9,
            "Negative": -1, "Boolean": True, "Text": "12", "Null": None,
            "Control\nName": 4, "bad": float("nan"), "infinity": float("inf"),
            "x" * 61: 2,
        })
        self.assertEqual(clean, {"Float": 7, "TypeScript": 80, "Python": 120, "Empty": 0})
        self.assertEqual(bounded_languages(None), {})
        self.assertEqual(bounded_languages(["Python"]), {})
        many = bounded_languages({f"Language{i:02d}": i + 1 for i in range(40)})
        self.assertEqual(len(many), 30)
        self.assertEqual(min(many.values()), 11)

    def test_file_selection_reserves_diverse_source_files(self):
        tree = [
            {"type": "blob", "path": "README.md", "size": 10},
            {"type": "blob", "path": "package.json", "size": 10},
            {"type": "blob", "path": "requirements.txt", "size": 10},
            {"type": "blob", "path": "pyproject.toml", "size": 10},
            {"type": "blob", "path": "backend/pyproject.toml", "size": 10},
            {"type": "blob", "path": "frontend/package.json", "size": 10},
            {"type": "blob", "path": "app/main.py", "size": 10},
            {"type": "blob", "path": "app/worker.py", "size": 10},
            {"type": "blob", "path": "db/schema.sql", "size": 10},
            {"type": "blob", "path": "web/api.ts", "size": 10},
            {"type": "blob", "path": "web/App.tsx", "size": 10},
            {"type": "blob", "path": "web/legacy.js", "size": 10},
        ]
        paths = select_candidate_paths(tree, 6)
        self.assertEqual(len(paths), 6)
        self.assertEqual(list(dict.fromkeys(p.rsplit(".", 1)[-1] for p in paths[:3])), ["py", "js", "ts"])
        self.assertFalse(any(p.lower().startswith("readme") for p in paths))
        self.assertNotIn("app/worker.py", paths)

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
