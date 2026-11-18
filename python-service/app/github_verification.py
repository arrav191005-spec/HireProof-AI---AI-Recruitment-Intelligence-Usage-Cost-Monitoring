"""Bounded, non-executing public GitHub evidence collection.

Repository content is untrusted data. This module never runs it and does not
send it to an AI model. A finding is an observation, not proof of authorship.
"""
import base64
import logging
import re
import time
from collections import deque
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
MAX_LANGUAGES = 30
MANIFESTS = {"package.json", "requirements.txt", "pyproject.toml", "pom.xml",
             "build.gradle", "build.gradle.kts"}
SOURCE_EXTENSIONS = (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".sql")
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


def bounded_languages(value) -> dict[str, int]:
    """Sanitize GitHub language byte counts before persistence.

    The database also validates this shape. Duplicate or malformed entries are
    dropped rather than failing an otherwise valid verification.
    """
    if not isinstance(value, dict):
        return {}
    items = []
    for name, amount in value.items():
        if not isinstance(name, str) or not 1 <= len(name) <= 60:
            continue
        if any(ord(char) < 32 for char in name):
            continue
        if isinstance(amount, bool) or not isinstance(amount, (int, float)):
            continue
        if amount < 0 or amount != amount or amount == float("inf"):
            continue
        items.append((name, int(amount)))
    items.sort(key=lambda item: (-item[1], item[0]))
    return dict(items[:MAX_LANGUAGES])


def _rank(path: str) -> tuple[int, int, str]:
    return (path.count("/"), len(path), path)


def select_candidate_paths(tree: list, budget: int) -> list[str]:
    """Choose a deterministic, size-safe mix of manifests and source files.

    Manifests can declare a technology that is never used, so half the file
    budget is reserved for source files spread across distinct extensions.
    README prose is selected last and is never treated as technology evidence.
    """
    manifests, readmes, sources = [], [], {}
    for item in tree[:10000]:
        if not isinstance(item, dict) or item.get("type") != "blob":
            continue
        path = item.get("path", "")
        size = item.get("size")
        if not isinstance(path, str) or len(path) > 240 or not isinstance(size, int) or size > MAX_FILE:
            continue
        if any(part in {"", ".", ".."} for part in path.split("/")):
            continue
        name = path.rsplit("/", 1)[-1].lower()
        extension = "." + name.rsplit(".", 1)[-1] if "." in name else ""
        if name in MANIFESTS:
            manifests.append(path)
        elif name.startswith("readme"):
            readmes.append(path)
        elif extension in SOURCE_EXTENSIONS:
            sources.setdefault(extension, []).append(path)

    # Round-robin across extensions so one large directory cannot consume the
    # whole budget before another technology is inspected.
    queues = [deque(sorted(sources[extension], key=_rank))
              for extension in SOURCE_EXTENSIONS if extension in sources]
    source_order = []
    while queues:
        remaining = []
        for queue in queues:
            source_order.append(queue.popleft())
            if queue:
                remaining.append(queue)
        queues = remaining

    reserve = min(len(source_order), max(1, budget // 2))
    selected = source_order[:reserve]
    for path in sorted(manifests, key=_rank) + source_order[reserve:] + sorted(readmes, key=_rank):
        if len(selected) >= budget:
            break
        if path not in selected:
            selected.append(path)
    return selected[:budget]


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
    source_excerpt: str | None = None


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
        languages = bounded_languages(self.get(root + "/languages"))
        tree = self.get(root + f"/git/trees/{sha}?recursive=1")
        if not isinstance(tree, dict) or not isinstance(tree.get("tree"), list):
            raise VerificationUnavailable("invalid_metadata")
        files = []
        for path in select_candidate_paths(tree["tree"], MAX_REQUESTS - self.requests):
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
        return {"repository_url": canonical, "commit_sha": sha, "languages": languages,
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


def _excerpt(text: str, match: re.Match) -> str:
    """Return a small printable context around a deterministic match."""
    start = max(0, match.start() - 120)
    end = min(len(text), match.end() + 180)
    value = " ".join(text[start:end].split())
    return value[:500]


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
            match = pattern.search(target)
            if match:
                excerpt = _excerpt(file["text"], match) if target == file["text"] else file["path"]
                findings.append(Finding(claim, "supporting", "A repository file contains a matching technology signal; this does not establish functionality or authorship.",
                                        file["url"], file["path"], snapshot["commit_sha"], excerpt))
                break
        else:
            findings.append(Finding(claim, "not_established", "No matching signal was found in the bounded set of inspected files."))
    return findings
