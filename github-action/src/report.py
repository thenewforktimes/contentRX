"""Format and post the PR comment.

Groups violations by file, renders a single Markdown comment, and posts
it to the pull request via the GitHub REST API. Uses urllib so the
Docker image doesn't need to install `requests`.

The comment is posted once per run. Subsequent runs would create
duplicate comments — BUILD_PLAN §15 tackles comment-replacement. For v1
we accept the duplication; it's visible and easy to reason about.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Iterable

from humanize import humanize_severity


GITHUB_API = "https://api.github.com"

# GitHub hard-caps issue comment bodies at 65,536 characters. We target a
# safely-under-limit threshold so any last-line Markdown closure we might
# append during truncation still fits. (GHA-C-01 from 2026-04-22 audit.)
MAX_COMMENT_CHARS = 60000
TRUNCATION_FOOTER = (
    "\n\n---\n"
    "_Comment truncated to fit GitHub's 65 KB limit. "
    "Run the action locally or check the workflow logs for the full list._"
)

# PR-39 — sticky comment marker. HTML comments render invisibly in
# GitHub Markdown but are visible when we fetch the comment list, so
# we can find and update our prior comment instead of posting a fresh
# one on every push. Pre-PR-39 ContentRX comments don't have this
# marker, so the first run after upgrade still posts a fresh one and
# every run after stays sticky.
STICKY_MARKER = "<!-- contentrx-action-sticky-comment -->"


@dataclass(frozen=True)
class FileReport:
    """All violations surfaced for one source file."""

    path: str
    # Each entry: { "text": str, "line": int, "kind": str,
    #               "violations": [ {standard_id, issue, suggestion} ] }
    entries: list[dict]


def render_markdown(
    reports: Iterable[FileReport],
    total_strings: int,
    *,
    truncated_count: int = 0,
    run_id: str | None = None,
) -> str:
    """Produce the body of the PR comment.

    `truncated_count` (PR-14): when > 0, the action capped extraction at
    `max-checks` and skipped this many strings beyond the cap. Surface a
    visible notice so the PR author knows coverage is partial and how to
    raise the cap.
    """
    reports = [r for r in reports if any(e.get("violations") for e in r.entries)]
    truncation_notice = _render_truncation_notice(total_strings, truncated_count)
    if not reports:
        body = (
            "### ContentRX\n\n"
            f"Checked {total_strings} string"
            f"{'' if total_strings == 1 else 's'}. All clear.\n"
        )
        if truncation_notice:
            body += "\n" + truncation_notice + "\n"
        if run_id:
            body += (
                f"\n*Run by the [ContentRX](https://contentrx.io) GitHub Action — "
                f"[full report on dashboard]"
                f"(https://contentrx.io/dashboard/runs/{run_id}).*"
            )
        else:
            body += "\n*Run by the [ContentRX](https://contentrx.io) GitHub Action.*"
        return body

    lines: list[str] = []
    total_violations = sum(
        len(entry.get("violations", []))
        for r in reports
        for entry in r.entries
    )

    lines.append("### ContentRX")
    lines.append("")
    # Per ADR 2026-04-29 §9 the customer-facing surface uses
    # "findings to adjust", not "violations". Substrate enums stay
    # in the API + DB.
    lines.append(
        f"Found **{total_violations} finding"
        f"{'' if total_violations == 1 else 's'} to adjust** across "
        f"**{len(reports)} file{'' if len(reports) == 1 else 's'}** "
        f"(checked {total_strings} string{'' if total_strings == 1 else 's'})."
    )
    lines.append("")

    for report in reports:
        lines.append(f"#### `{report.path}`")
        lines.append("")
        for entry in report.entries:
            violations = entry.get("violations") or []
            if not violations:
                continue
            label = f"L{entry['line']}"
            snippet = _truncate(entry["text"], 80)
            lines.append(f"- **{label}** — `{_escape_backticks(snippet)}`")
            for v in violations:
                # Schema 2.0.0 — public Violation fields only.
                # standard_id is substrate; the user-visible artifact is
                # severity + issue + suggestion. ADR 2026-04-25.
                # Per ADR 2026-04-29 §9 the severity enum is
                # humanized to "Worth adjusting" / "Quick polish" /
                # "Don't ship" at the rendering boundary.
                sev_label, _ = humanize_severity(v.get("severity", "medium"))
                issue = v.get("issue", "").strip()
                suggestion = v.get("suggestion", "").strip()
                lines.append(f"  - **{sev_label}**: {issue}")
                if suggestion:
                    # PR-36 — render the suggestion as a `diff`-fenced
                    # code block. GitHub renders these natively with
                    # red/green line backgrounds, so the change reads
                    # at a glance. Falls back to plain "_suggestion:_"
                    # when the original string is missing or identical
                    # (the latter shouldn't happen, but guard anyway).
                    original = entry.get("text", "")
                    if original and original.strip() != suggestion:
                        lines.append("")
                        lines.append("    ```diff")
                        lines.append(f"    - {original}")
                        lines.append(f"    + {suggestion}")
                        lines.append("    ```")
                    else:
                        lines.append(f"    - _suggestion:_ {suggestion}")
        lines.append("")

    if truncation_notice:
        lines.append(truncation_notice)
        lines.append("")

    lines.append("---")
    lines.append("")
    if run_id:
        # PR-40 — the dashboard run page survives the PR being closed,
        # the action log rolling over, etc. Linking from the footer
        # preserves the audit trail without bloating the comment.
        lines.append(
            f"*Run by the [ContentRX](https://contentrx.io) GitHub Action — "
            f"[full report on dashboard]"
            f"(https://contentrx.io/dashboard/runs/{run_id}). "
            "Rotate your API key at the [dashboard](https://contentrx.io/dashboard).*"
        )
    else:
        lines.append(
            "*Run by the [ContentRX](https://contentrx.io) GitHub Action. "
            "Rotate your API key at the [dashboard](https://contentrx.io/dashboard).*"
        )

    body = "\n".join(lines)
    # Enforce the GitHub char limit. Truncate at a line boundary where
    # possible so we don't leave a half-rendered Markdown list behind.
    if len(body) > MAX_COMMENT_CHARS:
        budget = MAX_COMMENT_CHARS - len(TRUNCATION_FOOTER)
        cut = body.rfind("\n", 0, budget)
        if cut < int(budget * 0.5):
            cut = budget  # extremely long single line — hard cut
        body = body[:cut] + TRUNCATION_FOOTER
    return body


def post_comment(
    body: str,
    *,
    repo: str,
    pull_number: int,
    token: str,
) -> dict:
    """Post or update the ContentRX PR comment.

    PR-39 — sticky behaviour. Prepend STICKY_MARKER to the body, then
    look up the prior ContentRX comment by scanning the PR's existing
    comments for the marker. Update-in-place when found, POST fresh
    when not. Pre-PR-39 comments stay in place as historical artifacts;
    this PR's first run is still a POST (no marker found), and
    subsequent runs are PATCHes (marker found on the new run's comment).
    """
    marked_body = STICKY_MARKER + "\n" + body
    existing_id = _find_sticky_comment_id(repo, pull_number, token)
    if existing_id is not None:
        return _patch_comment(existing_id, marked_body, repo=repo, token=token)
    return _create_comment(marked_body, repo=repo, pull_number=pull_number, token=token)


def _create_comment(
    body: str,
    *,
    repo: str,
    pull_number: int,
    token: str,
) -> dict:
    """POST a new PR comment via the GitHub API."""
    url = f"{GITHUB_API}/repos/{repo}/issues/{pull_number}/comments"
    data = json.dumps({"body": body}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers=_gh_headers(token),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Failed to post PR comment: {err.code} {err.reason}\n{body_text}"
        ) from err


def _patch_comment(
    comment_id: int,
    body: str,
    *,
    repo: str,
    token: str,
) -> dict:
    """PATCH an existing PR comment by id."""
    url = f"{GITHUB_API}/repos/{repo}/issues/comments/{comment_id}"
    data = json.dumps({"body": body}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="PATCH",
        headers=_gh_headers(token),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Failed to update PR comment {comment_id}: {err.code} {err.reason}\n{body_text}"
        ) from err


def _find_sticky_comment_id(
    repo: str,
    pull_number: int,
    token: str,
) -> int | None:
    """Scan the PR's issue comments for one carrying STICKY_MARKER.

    Returns the matching comment id, or None when no prior sticky
    comment exists. Paginated; capped at 10 pages (1,000 comments) to
    avoid rogue loops on pathological PRs. The match is on the marker
    string ANYWHERE in the body — so ordering of marker + content
    inside the body is irrelevant.
    """
    out: int | None = None
    url: str | None = (
        f"{GITHUB_API}/repos/{repo}/issues/{pull_number}/comments?per_page=100"
    )
    pages_fetched = 0
    MAX_PAGES = 10

    while url and pages_fetched < MAX_PAGES and out is None:
        req = urllib.request.Request(url, headers=_gh_headers(token))
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                entries = json.loads(resp.read().decode("utf-8"))
                link_header = resp.headers.get("Link", "")
        except urllib.error.HTTPError:
            # Comment list lookup failed — fall through to a fresh POST.
            # That degrades gracefully (an extra comment) without
            # crashing the run.
            return None

        for entry in entries:
            body_text = entry.get("body", "") or ""
            if STICKY_MARKER in body_text:
                out = int(entry["id"])
                break
        url = _parse_next_link(link_header)
        pages_fetched += 1

    return out


def _parse_next_link(link_header: str) -> str | None:
    """Extract the rel="next" URL from a GitHub Link header. Lifted from
    main.py's PR-files pagination — kept here as a private copy to
    avoid an action-internal cross-import."""
    if not link_header:
        return None
    for part in link_header.split(","):
        segment = part.strip()
        if 'rel="next"' not in segment:
            continue
        start = segment.find("<")
        end = segment.find(">", start)
        if start != -1 and end != -1:
            return segment[start + 1 : end]
    return None


def _gh_headers(token: str) -> dict:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "contentrx-action",
    }


def _render_truncation_notice(checked: int, truncated_count: int) -> str:
    """Build a "⚠️ this PR was capped" notice. Empty when nothing skipped."""
    if truncated_count <= 0:
        return ""
    total = checked + truncated_count
    return (
        f"> ⚠️ **This PR has {total} strings. ContentRX checked the "
        f"first {checked}; {truncated_count} more weren't checked.** "
        "Raise `max-checks` in your workflow config to check all of "
        "them, or run a one-off Audit Pack ($99 for 25,000 checks) "
        "for codebase-wide audits."
    )


def _truncate(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def _escape_backticks(s: str) -> str:
    # Stop backticks in the string from breaking out of the inline code.
    return s.replace("`", "\u2018")
