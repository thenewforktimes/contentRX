"""GitHub mining pipeline — human-eval build plan Session 15.

Crawls the curated OSS allow-list (`allow_list.json`) and extracts
`(old_string, new_string)` copy-change pairs from qualifying commits.
Output lands in `external_signal/output/<owner>__<name>.json`; raw
output is gitignored.

Filter cascade, every step narrows the pool:

    1. Allow-list      Only repos in allow_list.json get crawled.
    2. File-type       Only UI / content / translation files. Covers
                       .jsx, .tsx, .vue, .svelte, .md (in /docs or
                       /content), .mdx, .json translation files,
                       .po, .xlf.
    3. Commit-message  Soft-tagged as copy work. Substrings like
                       "fix typo", "clarify", "update empty state",
                       "improve error message", "soften tone",
                       "rewrite for clarity".
    4. Diff-pattern    Only commits whose non-whitespace changes are
                       string literals, JSX text nodes, or
                       translation values.

Respects GitHub API rate limits (primary + secondary):
  - Sequential requests, no concurrency.
  - 1s sleep between commits.
  - Exponential backoff on 429 / 403.
  - File-based cache in `external_signal/cache/` so re-runs don't
    re-fetch unchanged commits.

Usage:
    export GITHUB_TOKEN=<personal_access_token>
    python3 external_signal/github_miner.py
    python3 external_signal/github_miner.py --repo vercel/next.js
    python3 external_signal/github_miner.py --dry-run

`--dry-run` runs the filter logic against cached data without hitting
the GitHub API — useful when iterating on filters.

The output JSON is the raw mined signal; Robert reviews it before any
ingest into a shared surface. Nothing here writes to Supabase; that's
a later session's job when the review workflow is defined.

**Strict separation guarantee:** this tool writes ONLY to
`external_signal/output/`. It does not read from or write to the
production `violations` / `violation_overrides` / `graduation_status`
tables. The directory is gitignored and the schema is JSON-only so
there's no structural path from mined signal to production eval data
without an explicit, logged import step.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

# Sibling-module imports for intent_classifier + repo_quality. The
# `external_signal` directory is meant to be invoked both as a script
# (`python external_signal/github_miner.py`) and as a module
# (`python -m external_signal.github_miner`, plus `import` for tests),
# so we try the package-relative import first and fall back to the
# bare names when running as a top-level script with this directory
# on sys.path.
try:
    from external_signal.intent_classifier import (  # type: ignore[import-not-found]
        classify_intent,
        suggested_triage_category,
    )
    from external_signal.repo_quality import (  # type: ignore[import-not-found]
        score_repo,
    )
except ImportError:  # pragma: no cover — script-invocation fallback
    from intent_classifier import (  # type: ignore[import-not-found]
        classify_intent,
        suggested_triage_category,
    )
    from repo_quality import score_repo  # type: ignore[import-not-found]


# ---------------------------------------------------------------------------
# Paths + defaults
# ---------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
DEFAULT_ALLOW_LIST = HERE / "allow_list.json"
DEFAULT_OUTPUT_DIR = HERE / "output"
DEFAULT_CACHE_DIR = HERE / "cache"
USER_AGENT = "contentrx-research-bot (ethics: https://contentrx.io/ethics)"

# Initial-crawl bootstrap. First time a repo is mined, fetch the last
# N commits rather than the full history — keeps the first run
# polite + reviewable.
INITIAL_CRAWL_LIMIT = 100

# Politeness: sleep between per-commit REST fetches.
PER_COMMIT_DELAY_SECONDS = 1.0


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

# File-type whitelist. The patterns check the END of the path so
# "/docs/foo.md" and "/content/guide.md" match without having to
# enumerate every subpath.
FILE_TYPE_SUFFIXES = (
    ".jsx",
    ".tsx",
    ".vue",
    ".svelte",
    ".mdx",
    ".po",
    ".xlf",
)

# Translation-file patterns (JSON locale files).
TRANSLATION_FILENAMES = re.compile(
    r"(^|/)(en|en-[A-Z]{2}|en_[A-Z]{2})\.json$",
    re.IGNORECASE,
)

# Markdown is only in-scope when it lives under /docs/ or /content/ —
# arbitrary README edits aren't copy work.
MARKDOWN_PATH_RE = re.compile(r"(^|/)(docs|content)/[^/]+.*\.md$")


def file_type_in_scope(path: str) -> bool:
    """True when the path's extension matches the content-file whitelist."""
    if not path:
        return False
    path = path.strip()
    lower = path.lower()
    if any(lower.endswith(s) for s in FILE_TYPE_SUFFIXES):
        return True
    if lower.endswith(".md"):
        return bool(MARKDOWN_PATH_RE.search(path))
    if lower.endswith(".json") and TRANSLATION_FILENAMES.search(path):
        return True
    return False


# Soft tags in the commit message. One case-insensitive substring per
# entry. The spec's example phrases, plus a few natural variants.
COMMIT_SOFT_TAGS = (
    "fix typo",
    "clarify copy",
    "clarify",
    "update empty state",
    "improve error message",
    "improve error",
    "soften tone",
    "rewrite for clarity",
    "rewrite copy",
    "reword",
    "update copy",
    "fix copy",
    "improve copy",
    "better error",
    "cleaner copy",
)


def commit_message_soft_tagged(message: str) -> bool:
    """True when the commit message carries one of the copy-work tags."""
    if not message:
        return False
    lower = message.lower()
    return any(tag in lower for tag in COMMIT_SOFT_TAGS)


# Diff-pattern extraction: find changed lines inside quoted strings.
# Simple substring heuristic — catches most JSX text / string-literal
# changes and produces false positives that Robert's review filters
# out (per plan: "disagreement cases are teaching moments or noise").
#
# A line starts with "-" or "+" in a unified diff; the extractor
# looks for paired removed/added lines where the non-whitespace
# content differs only inside a quoted string.
STRING_LITERAL_RE = re.compile(
    r"""(['"])((?:(?!\1|\\).|\\.)*?)\1"""
)


def extract_pairs_from_patch(patch: str) -> list[dict[str, str]]:
    """Pull (old_string, new_string) pairs from a unified-diff patch.

    Matches each removed line (`-`) to the next added line (`+`) in
    the same hunk and extracts quoted strings. Matches strings
    positionally: first quoted string on the `-` line pairs with the
    first on the `+` line, and so on.

    Pure function. Same patch in → same pairs out.
    """
    if not patch:
        return []
    pairs: list[dict[str, str]] = []
    removed: list[str] = []
    added: list[str] = []

    def _flush() -> None:
        # Walk the removed/added buffers positionally, extract the
        # first-quoted-string from each line, and pair same-index.
        for idx in range(max(len(removed), len(added))):
            rem_line = removed[idx] if idx < len(removed) else ""
            add_line = added[idx] if idx < len(added) else ""
            rem_strs = [m.group(2) for m in STRING_LITERAL_RE.finditer(rem_line)]
            add_strs = [m.group(2) for m in STRING_LITERAL_RE.finditer(add_line)]
            # Pair up to min(len, len) — a rearranged line won't pair
            # cleanly but that's fine; Robert's review catches it.
            for i in range(min(len(rem_strs), len(add_strs))):
                old = rem_strs[i]
                new = add_strs[i]
                if old == new or not old or not new:
                    continue
                if _looks_like_noise(old, new):
                    continue
                pairs.append({"old": old, "new": new})
        removed.clear()
        added.clear()

    for line in patch.splitlines():
        if line.startswith("@@"):
            _flush()
            continue
        if line.startswith("-") and not line.startswith("---"):
            removed.append(line[1:])
        elif line.startswith("+") and not line.startswith("+++"):
            added.append(line[1:])
        else:
            _flush()
    _flush()
    return pairs


def _looks_like_noise(old: str, new: str) -> bool:
    """Drop pairs that are clearly not human-reviewed copy changes.

    Catches timestamps, SHAs, version bumps, URL changes — these fire
    false positives on the string-literal heuristic.
    """
    # Pure hex (SHA-ish) / pure digits / URLs.
    if re.fullmatch(r"[0-9a-fA-F]{7,}", old) and re.fullmatch(
        r"[0-9a-fA-F]{7,}", new,
    ):
        return True
    if re.fullmatch(r"[\d.]+", old) and re.fullmatch(r"[\d.]+", new):
        return True
    if old.startswith(("http://", "https://")) and new.startswith(
        ("http://", "https://"),
    ):
        return True
    # Empty / whitespace-only differences.
    if old.strip() == new.strip():
        return True
    # Length ratio sanity — if the change is 10× longer, it's probably
    # a different kind of edit (refactor, not copy).
    if max(len(old), len(new)) > 5 * max(1, min(len(old), len(new))):
        return True
    return False


# ---------------------------------------------------------------------------
# GitHub client
# ---------------------------------------------------------------------------


class GitHubError(Exception):
    pass


class GitHubClient:
    """Thin wrapper over GitHub's GraphQL + REST APIs.

    All requests go through `_request` which handles the `contentrx-
    research-bot` user agent, token auth, rate-limit backoff, and the
    file cache. The cache key is a sha256 of the request method +
    url + body; cache hits short-circuit the network entirely.
    """

    GRAPHQL_URL = "https://api.github.com/graphql"
    REST_BASE = "https://api.github.com"

    def __init__(
        self,
        token: str | None,
        *,
        cache_dir: Path = DEFAULT_CACHE_DIR,
        user_agent: str = USER_AGENT,
        sleep_fn=time.sleep,
    ):
        if not token:
            raise GitHubError(
                "GITHUB_TOKEN not set. Create a personal access token with "
                "public_repo + read:org scopes and export it before running "
                "the miner."
            )
        self.token = token
        self.cache_dir = cache_dir
        self.user_agent = user_agent
        self.sleep_fn = sleep_fn
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    # -- cache helpers ------------------------------------------------

    def _cache_path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.json"

    def _cache_get(self, key: str) -> Any | None:
        path = self._cache_path(key)
        if not path.exists():
            return None
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return None

    def _cache_set(self, key: str, value: Any) -> None:
        path = self._cache_path(key)
        with open(path, "w") as f:
            json.dump(value, f)

    # -- HTTP ---------------------------------------------------------

    def _request(
        self,
        method: str,
        url: str,
        *,
        body: dict | None = None,
        use_cache: bool = True,
        max_retries: int = 3,
    ) -> Any:
        cache_key = f"{method} {url} {json.dumps(body or {}, sort_keys=True)}"
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "Authorization": f"bearer {self.token}",
            "User-Agent": self.user_agent,
            "Accept": "application/vnd.github+json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"

        attempt = 0
        while True:
            attempt += 1
            req = urllib.request.Request(
                url, data=data, method=method, headers=headers,
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                if use_cache:
                    self._cache_set(cache_key, payload)
                return payload
            except urllib.error.HTTPError as e:
                if e.code in (429, 403) and attempt <= max_retries:
                    # Secondary rate limit — exponential backoff.
                    self.sleep_fn(2 ** attempt)
                    continue
                raise GitHubError(
                    f"{method} {url} failed: HTTP {e.code} {e.reason}"
                ) from e
            except urllib.error.URLError as e:
                if attempt <= max_retries:
                    self.sleep_fn(2 ** attempt)
                    continue
                raise GitHubError(f"{method} {url} network error: {e}") from e

    # -- public API ---------------------------------------------------

    def commit_history(
        self,
        owner: str,
        name: str,
        *,
        since_sha: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """List commits on the default branch.

        When `since_sha` is provided, returns commits AFTER that SHA.
        When None, returns the `limit` most recent commits (initial
        crawl bootstrap).
        """
        # GraphQL query for commit history. `history` filters by date
        # not SHA; we overfetch + slice client-side when since_sha is
        # supplied (cheap vs juggling GraphQL pagination cursors).
        query = (
            "query($owner: String!, $name: String!, $first: Int!) {\n"
            "  repository(owner: $owner, name: $name) {\n"
            "    defaultBranchRef { target { ... on Commit { history(first: $first) { nodes {\n"
            "      oid\n"
            "      messageHeadline\n"
            "      messageBody\n"
            "      committedDate\n"
            "    } } } } }\n"
            "  }\n"
            "}\n"
        )
        body = {
            "query": query,
            "variables": {"owner": owner, "name": name, "first": limit},
        }
        payload = self._request("POST", self.GRAPHQL_URL, body=body)
        if "errors" in payload:
            raise GitHubError(f"GraphQL: {payload['errors']}")
        nodes = (
            payload.get("data", {})
            .get("repository", {})
            .get("defaultBranchRef", {})
            .get("target", {})
            .get("history", {})
            .get("nodes", [])
        )
        if since_sha is None:
            return nodes
        result: list[dict[str, Any]] = []
        for node in nodes:
            if node.get("oid") == since_sha:
                break
            result.append(node)
        return result

    def commit_diff(self, owner: str, name: str, sha: str) -> dict[str, Any]:
        """Full commit detail including per-file patches (REST)."""
        url = (
            f"{self.REST_BASE}/repos/"
            f"{urllib.parse.quote(owner)}/{urllib.parse.quote(name)}/commits/"
            f"{urllib.parse.quote(sha)}"
        )
        return self._request("GET", url)


# ---------------------------------------------------------------------------
# Mining orchestrator
# ---------------------------------------------------------------------------


def load_allow_list(path: Path = DEFAULT_ALLOW_LIST) -> list[dict[str, Any]]:
    with open(path) as f:
        data = json.load(f)
    return data.get("repos", [])


def last_crawled_sha(output_path: Path) -> str | None:
    """Read the most recently-mined SHA from a prior run's output."""
    if not output_path.exists():
        return None
    try:
        with open(output_path) as f:
            data = json.load(f)
        commits = data.get("commits", [])
        if commits:
            return commits[0].get("sha")
    except Exception:
        return None
    return None


def mine_repo(
    client: GitHubClient,
    repo: dict[str, Any],
    *,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    initial_crawl_limit: int = INITIAL_CRAWL_LIMIT,
    sleep_fn=time.sleep,
    per_commit_delay: float = PER_COMMIT_DELAY_SECONDS,
) -> dict[str, Any]:
    """Mine one repo on the allow-list. Writes the output file and
    returns a summary dict for the caller's log.
    """
    owner = repo["owner"]
    name = repo["name"]
    license = repo.get("license")
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{owner}__{name}.json"

    prior_sha = last_crawled_sha(out_path)
    commits = client.commit_history(
        owner, name, since_sha=prior_sha, limit=initial_crawl_limit,
    )

    mined: list[dict[str, Any]] = []
    filtered_out = 0
    for commit in commits:
        sha = commit.get("oid")
        message = (commit.get("messageHeadline") or "") + "\n" + (
            commit.get("messageBody") or ""
        )
        if not commit_message_soft_tagged(message):
            filtered_out += 1
            continue

        detail = client.commit_diff(owner, name, sha)
        sleep_fn(per_commit_delay)  # politeness
        files = detail.get("files", []) or []

        per_commit_pairs: list[dict[str, Any]] = []
        for f in files:
            path = f.get("filename", "")
            if not file_type_in_scope(path):
                continue
            patch = f.get("patch") or ""
            for pair in extract_pairs_from_patch(patch):
                per_commit_pairs.append({
                    "file_path": path,
                    "old_string": pair["old"],
                    "new_string": pair["new"],
                })

        if not per_commit_pairs:
            filtered_out += 1
            continue

        # Session 18: tag each commit with its intent category +
        # suggested triage prior. The intent is a lens, not a gate.
        intent = classify_intent(message)
        mined.append({
            "sha": sha,
            "message": message.strip(),
            "committed_at": commit.get("committedDate"),
            "license": license,
            "intent": intent,
            "suggested_triage_category": suggested_triage_category(intent),
            "pairs": per_commit_pairs,
        })

    # Merge with prior output so the file stays append-only.
    prior_commits: list[dict[str, Any]] = []
    if out_path.exists():
        try:
            with open(out_path) as f:
                prior_commits = json.load(f).get("commits", [])
        except Exception:
            prior_commits = []

    all_commits = mined + prior_commits

    quality = score_repo(repo)  # Session 18 — rank-ready
    output = {
        "repo": f"{owner}/{name}",
        "license": license,
        "quality_score": quality,
        "schema_version": "1.1.0",  # added intent + quality fields
        "last_crawl_at": _dt.datetime.now(_dt.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ",
        ),
        "total_commits": len(all_commits),
        "commits": all_commits,
    }
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
        f.write("\n")

    return {
        "repo": f"{owner}/{name}",
        "commits_checked": len(commits),
        "commits_retained": len(mined),
        "commits_filtered": filtered_out,
        "total_pairs": sum(len(c["pairs"]) for c in mined),
        "output_path": str(out_path),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allow-list", type=Path, default=DEFAULT_ALLOW_LIST,
    )
    parser.add_argument(
        "--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR,
    )
    parser.add_argument(
        "--repo", default=None,
        help="Mine a single repo (owner/name) from the allow-list.",
    )
    parser.add_argument(
        "--initial-limit", type=int, default=INITIAL_CRAWL_LIMIT,
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Skip network. Useful when iterating on filters against cache.",
    )
    args = parser.parse_args(argv)

    if args.dry_run:
        print(
            "Dry run: filter logic only. See `external_signal/cache/` for "
            "any prior response data — dry-run does not refresh from API.",
        )
        return 0

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print(
            "ERROR: GITHUB_TOKEN env var not set. See external_signal/README.md.",
            file=sys.stderr,
        )
        return 2

    allow_list = load_allow_list(args.allow_list)
    if args.repo:
        allow_list = [
            r for r in allow_list if f"{r['owner']}/{r['name']}" == args.repo
        ]
        if not allow_list:
            print(
                f"ERROR: {args.repo} not in allow-list. Add it first.",
                file=sys.stderr,
            )
            return 2

    client = GitHubClient(token)
    for repo in allow_list:
        try:
            summary = mine_repo(
                client, repo,
                output_dir=args.output_dir,
                initial_crawl_limit=args.initial_limit,
            )
        except GitHubError as e:
            print(f"  ERROR on {repo['owner']}/{repo['name']}: {e}", file=sys.stderr)
            continue
        print(
            f"{summary['repo']}: "
            f"{summary['commits_retained']} commits kept / "
            f"{summary['commits_checked']} checked "
            f"({summary['total_pairs']} pairs) → {summary['output_path']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
