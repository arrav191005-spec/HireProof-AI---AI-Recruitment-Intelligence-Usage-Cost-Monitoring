"""Bounded, non-executing public GitHub evidence collection.

Repository content is untrusted data. This module never runs it and does not
send it to an AI model. A finding is an observation, not proof of authorship.
"""
import base64
import logging
import re
import time
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

import httpx

# HTTPX's INFO logs include the full URL, including potentially confidential
# repository and file names. Do not emit request URLs from this service.
logging.getLogger("httpx").setLevel(logging.WARNING)

API = "https://api.github.com"
MAX_REQUESTS = 12
MAX_BODY = 512_000
MAX_FILE = 64_000
MAX_SECONDS = 20
API_VERSION = "2022-11-28"
_OWNER = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
_REPO = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_SHA = re.compile(r"^[0-9a-f]{40}$")


def github_headers(token: str | None = None) -> dict[str, str]:
    """Headers for GitHub REST. The token stays server-side and is never logged."""
    headers = {
        "User-Agent": "HireProof-AI-Verification",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    return headers


class VerificationUnavailable(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def normalize_repository_url(value: str) -> tuple[str, str, str]:
    url = urlsplit(value.strip())
    if (url.scheme != "https" or url.netloc.lower() != "github.com"
            or url.query or url.fragment or url.username or url.password):
        raise ValueError("Expected a canonical HTTPS GitHub repository URL.")
    parts = url.path.strip("/").split("/")
    if len(parts) != 2:
        raise ValueError("Expected an owner and repository.")
    owner, repo = parts
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not _OWNER.fullmatch(owner) or not _REPO.fullmatch(repo) or repo in {".", ".."}:
        raise ValueError("Invalid GitHub repository identifier.")
    return owner, repo, f"https://github.com/{owner}/{repo}"


@dataclass(frozen=True)
class Finding:
    claim: str
    status: str
    explanation: str
    source_url: str | None = None
    file_path: str | None = None
    commit_sha: str | None = None


class GitHubCollector:
    def __init__(self, client: httpx.Client):
        self.client = client
        self.requests = 0
        self.deadline = time.monotonic() + MAX_SECONDS

    def get(self, path: str, *, optional: bool = False):
        if self.requests >= MAX_REQUESTS or time.monotonic() >= self.deadline:
            raise VerificationUnavailable("limit_exceeded")
        self.requests += 1
        try:
            with self.client.stream("GET", API + path, follow_redirects=False,
                                    timeout=min(5.0, max(0.1, self.deadline - time.monotonic()))) as response:
                if response.status_code == 404 and optional:
                    return None
                if response.status_code == 404:
                    raise VerificationUnavailable("not_found_or_inaccessible")
                if response.status_code == 429 or (response.status_code == 403 and response.headers.get("x-ratelimit-remaining") == "0"):
                    raise VerificationUnavailable("rate_limited")
                if response.status_code in (401, 403):
                    raise VerificationUnavailable("inaccessible")
                if response.status_code != 200:
                    raise VerificationUnavailable("github_unavailable")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BODY or time.monotonic() >= self.deadline:
                        raise VerificationUnavailable("response_limit")
                import json
                return json.loads(body)
        except (httpx.HTTPError, ValueError):
            raise VerificationUnavailable("github_unavailable") from None

    def collect(self, repository_url: str) -> dict:
        owner, repo, canonical = normalize_repository_url(repository_url)
        root = f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}"
        metadata = self.get(root)
        if not isinstance(metadata, dict) or metadata.get("private") is not False:
            raise VerificationUnavailable("inaccessible")
        branch = metadata.get("default_branch")
        if not isinstance(branch, str) or not branch or len(branch) > 200:
            raise VerificationUnavailable("invalid_metadata")
        commit = self.get(root + "/commits/" + quote(branch, safe=""))
        sha = commit.get("sha", "") if isinstance(commit, dict) else ""
        if not isinstance(sha, str) or not _SHA.fullmatch(sha):
            raise VerificationUnavailable("invalid_metadata")
        languages = self.get(root + "/languages")
        tree = self.get(root + f"/git/trees/{sha}?recursive=1")
        if not isinstance(tree, dict) or not isinstance(tree.get("tree"), list):
            raise VerificationUnavailable("invalid_metadata")
        candidates = []
        for item in tree["tree"][:10000]:
            if not isinstance(item, dict) or item.get("type") != "blob":
                continue
            path = item.get("path", "")
            size = item.get("size")
            if not isinstance(path, str) or len(path) > 240 or not isinstance(size, int) or size > MAX_FILE:
                continue
            if any(p in {"", ".", ".."} for p in path.split("/")):
                continue
            lower = path.lower()
            if lower.endswith(("readme.md", "package.json", "requirements.txt", "pyproject.toml",
                               "pom.xml", "build.gradle", "build.gradle.kts", ".py", ".js", ".jsx",
                               ".ts", ".tsx", ".java", ".sql")):
                candidates.append(path)
        candidates.sort(key=lambda p: (not p.lower().endswith(("readme.md", "package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "build.gradle.kts")), p))
        files = []
        for path in candidates[:MAX_REQUESTS - self.requests]:
            data = self.get(root + "/contents/" + quote(path, safe="/") + "?ref=" + sha, optional=True)
            if not isinstance(data, dict) or data.get("encoding") != "base64":
                continue
            try:
                content = base64.b64decode(data.get("content", ""), validate=False)
            except (ValueError, TypeError):
                continue
            if len(content) > MAX_FILE:
                continue
            files.append({"path": path, "text": content.decode("utf-8", errors="replace"),
                          "url": f"{canonical}/blob/{sha}/{quote(path, safe='/')}"})
        return {"repository_url": canonical, "commit_sha": sha, "languages": languages if isinstance(languages, dict) else {},
                "files": files, "tree_truncated": bool(tree.get("truncated"))}


_PATTERNS = {
    "javascript": re.compile(r"\.(?:js|jsx)$", re.I),
    "typescript": re.compile(r"\.(?:ts|tsx)$", re.I),
    "python": re.compile(r"\.py$", re.I),
    "java": re.compile(r"\.java$", re.I),
    "react": re.compile(r'["\']react["\']|from\s+["\']react["\']', re.I),
    "fastapi": re.compile(r"\bfastapi\b", re.I),
    "postgresql": re.compile(r"\b(?:postgresql|postgres|psycopg)\b", re.I),
    "spring boot": re.compile(r"\bspring-boot\b|org\.springframework\.boot", re.I),
}


def evaluate_claims(snapshot: dict, claims: list[str]) -> list[Finding]:
    findings = []
    for claim in claims:
        pattern = _PATTERNS.get(claim.strip().lower())
        if pattern is None:
            findings.append(Finding(claim, "needs_review", "This claim is not covered by deterministic technology checks."))
            continue
        for file in snapshot["files"]:
            # README prose is a claim, not independent evidence of a stack.
            if file["path"].lower().split("/")[-1].startswith("readme"):
                continue
            target = file["path"] if claim.strip().lower() in {"javascript", "typescript", "python", "java"} else file["text"]
            if pattern.search(target):
                findings.append(Finding(claim, "supporting", "A repository file contains a matching technology signal; this does not establish functionality or authorship.",
                                        file["url"], file["path"], snapshot["commit_sha"]))
                break
        else:
            findings.append(Finding(claim, "not_established", "No matching signal was found in the bounded set of inspected files."))
    return findings
