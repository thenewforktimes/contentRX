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
            f"{'' if total_strings == 1 else 's'}. No content-standard violations.\n"
        )
        if truncation_notice:
            body += "\n" + truncation_notice + "\n"
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
    lines.append(
        f"Found **{total_violations} violation"
        f"{'' if total_violations == 1 else 's'}** across "
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
                severity = v.get("severity", "medium").upper()
                issue = v.get("issue", "").strip()
                suggestion = v.get("suggestion", "").strip()
                lines.append(f"  - **{severity}**: {issue}")
                if suggestion:
                    lines.append(f"    - _suggestion:_ {suggestion}")
        lines.append("")

    if truncation_notice:
        lines.append(truncation_notice)
        lines.append("")

    lines.append("---")
    lines.append("")
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
    """POST a new PR comment via the GitHub API. Returns the decoded response."""
    url = f"{GITHUB_API}/repos/{repo}/issues/{pull_number}/comments"
    data = json.dumps({"body": body}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "contentrx-action",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        # Bubble up with enough context for the action log to explain.
        body_text = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Failed to post PR comment: {err.code} {err.reason}\n{body_text}"
        ) from err


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
