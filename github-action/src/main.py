"""Entry point called by entrypoint.sh inside the GHA Docker container.

Pipeline:
    1. Load changed files from the pull_request event payload.
    2. Filter by the `paths` glob input.
    3. Extract candidate strings via src/extract.py.
    4. For each string, call `contentrx --json` (the CLI installed from
       PyPI at image-build time) and collect violations.
    5. Format a Markdown PR comment via src/report.py and POST it.
    6. Exit non-zero iff strict=true AND any violations were found.

Deliberately side-effect-free for testing: every I/O boundary (GitHub
event reading, contentrx subprocess, comment posting) is factored out
so tests/test_main.py can monkeypatch without forking a real container.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from extract import Extraction, extract_strings, matches_glob
from report import FileReport, post_comment, render_markdown


def load_event() -> dict:
    """Parse the pull_request event payload GitHub Actions writes to disk."""
    path = os.environ.get("GITHUB_EVENT_PATH")
    if not path:
        raise RuntimeError("GITHUB_EVENT_PATH not set — is this running under Actions?")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def changed_files(event: dict, workspace: Path) -> list[Path]:
    """Files touched by the pull_request. Falls back to all matching files
    if we can't read the diff from the event — better to over-lint on a
    weird event than to silently skip."""
    pr = event.get("pull_request") or {}
    repo = (event.get("repository") or {}).get("full_name")
    number = pr.get("number")
    token = os.environ.get("GITHUB_TOKEN")

    if repo and number and token:
        try:
            return _fetch_changed_from_api(repo, number, token, workspace)
        except Exception as err:  # noqa: BLE001 — fall back, don't crash the run
            print(
                f"warning: couldn't read PR files via API ({err}); "
                "falling back to full tree scan",
                file=sys.stderr,
            )
    return [p for p in workspace.rglob("*") if p.is_file()]


def _fetch_changed_from_api(
    repo: str, number: int, token: str, workspace: Path
) -> list[Path]:
    import urllib.request

    url = f"https://api.github.com/repos/{repo}/pulls/{number}/files?per_page=100"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "contentrx-action",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        entries = json.loads(resp.read().decode("utf-8"))
    out: list[Path] = []
    for e in entries:
        if e.get("status") == "removed":
            continue
        out.append(workspace / e["filename"])
    return out


def run_contentrx(text: str, content_type: str) -> dict:
    """Call the installed `contentrx` CLI with --json and return parsed output."""
    env = os.environ.copy()
    # Propagate CONTENTRX_API_KEY / CONTENTRX_API_URL — already in env via
    # entrypoint.sh. Nothing else to do.
    result = subprocess.run(
        ["contentrx", "--json", "--content-type", content_type, text],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )
    # The CLI's non-zero exit indicates violations (1) or an error (3+).
    # We only care about the stdout JSON here; the action's own exit
    # code is decided in main() based on strict + aggregate violations.
    if result.returncode >= 3:
        sys.stderr.write(
            f"contentrx CLI error (exit {result.returncode}): {result.stderr}\n"
        )
        return {
            "result": {
                "overall_verdict": "error",
                "violations": [],
                "content_type": content_type,
                "summary": "CLI error — see action logs.",
            }
        }
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(
            f"contentrx CLI returned non-JSON output: {result.stdout[:500]}\n"
        )
        return {
            "result": {
                "overall_verdict": "error",
                "violations": [],
                "content_type": content_type,
                "summary": "CLI returned unreadable output.",
            }
        }


def collect_reports(
    extractions: list[Extraction],
    *,
    content_type: str,
) -> list[FileReport]:
    """Call the CLI for each extracted string, bucketed by source file."""
    by_file: dict[str, list[dict]] = {}
    for ext in extractions:
        response = run_contentrx(ext.text, content_type)
        result = response.get("result") or {}
        entry = {
            "text": ext.text,
            "line": ext.line,
            "kind": ext.kind,
            "violations": result.get("violations") or [],
        }
        by_file.setdefault(ext.source_file, []).append(entry)

    return [FileReport(path=p, entries=entries) for p, entries in by_file.items()]


def main() -> int:
    workspace = Path(os.environ.get("GITHUB_WORKSPACE", os.getcwd()))
    paths_glob = os.environ.get("CONTENTRX_PATHS", "**/*.{tsx,jsx,html}")
    content_type = os.environ.get("CONTENTRX_CONTENT_TYPE", "short_ui_copy")
    strict = os.environ.get("CONTENTRX_STRICT", "false").lower() == "true"

    event = load_event()
    files = changed_files(event, workspace)
    matching = [
        p
        for p in files
        if p.is_file()
        and matches_glob(str(p.relative_to(workspace)), paths_glob)
    ]

    if not matching:
        print("ContentRX: no files matched the path filter. Nothing to check.")
        _write_output("violations", "0")
        _write_output("passed", "true")
        return 0

    extractions: list[Extraction] = []
    for p in matching:
        try:
            extractions.extend(extract_strings(p))
        except Exception as err:  # noqa: BLE001
            print(f"warning: could not read {p}: {err}", file=sys.stderr)

    reports = collect_reports(extractions, content_type=content_type)
    total_violations = sum(
        len(e.get("violations", []))
        for r in reports
        for e in r.entries
    )

    body = render_markdown(reports, total_strings=len(extractions))

    pull_number = (event.get("pull_request") or {}).get("number")
    repo = (event.get("repository") or {}).get("full_name")
    token = os.environ.get("GITHUB_TOKEN")
    if pull_number and repo and token:
        try:
            post_comment(body, repo=repo, pull_number=int(pull_number), token=token)
        except Exception as err:  # noqa: BLE001
            print(f"warning: comment post failed: {err}", file=sys.stderr)
    else:
        # Not running in a PR (or missing token). Still useful to print the
        # report so workflow_dispatch runs have something to read.
        print(body)

    _write_output("violations", str(total_violations))
    _write_output("passed", "true" if total_violations == 0 else "false")

    if strict and total_violations > 0:
        return 1
    return 0


def _write_output(name: str, value: str) -> None:
    # GHA's official "outputs" mechanism: append to $GITHUB_OUTPUT.
    out_path = os.environ.get("GITHUB_OUTPUT")
    if not out_path:
        return
    with open(out_path, "a", encoding="utf-8") as f:
        f.write(f"{name}={value}\n")


if __name__ == "__main__":
    sys.exit(main())
