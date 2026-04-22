"""Entry point called by entrypoint.sh inside the GHA Docker container.

Pipeline (v2 — Session 15):
    1. Parse the pull_request event payload for PR number + repo
    2. Fetch changed files via the GitHub Files API; fall back to a
       full tree scan if the API call fails
    3. Filter by the `paths` glob input
    4. Split into JSX/TSX/JS/TS (AST path) and HTML (regex path)
    5. Run the Node AST extractor once over the JSX set, parse NDJSON
       output into Extractions. Run the regex extractor on HTML.
    6. Call `contentrx --json --file-path` for each extracted string
    7. Group violations by file, render a Markdown comment, POST to PR
    8. Exit 0 unless strict=true AND violations > 0

The Node extractor emits repo-relative file paths so we can pass them
straight to contentrx, which forwards them as `file_path` on the
/api/check request → violations row → team analytics "Top files".
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from extract import Extraction, extract_strings, matches_glob
from report import FileReport, post_comment, render_markdown


AST_EXTRACTOR = "/action/src/extract.mjs"
AST_EXTENSIONS = (".jsx", ".tsx", ".js", ".ts", ".mjs", ".cjs")
HTML_EXTENSIONS = (".html", ".htm")


def load_event() -> dict:
    """Parse the pull_request event payload GitHub Actions writes to disk."""
    path = os.environ.get("GITHUB_EVENT_PATH")
    if not path:
        raise RuntimeError("GITHUB_EVENT_PATH not set — is this running under Actions?")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def changed_files(event: dict, workspace: Path) -> list[Path]:
    """Files touched by the pull_request. Falls back to all matching files
    if we can't read the diff from the event."""
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
    """Fetch the full list of files changed in a PR.

    Follows RFC-5988 `Link: <...>; rel="next"` pagination, so PRs with
    more than 100 changed files don't silently drop the tail.
    GitHub caps per_page at 100; the number of pages we follow is
    capped at 30 (3,000 files) to avoid rogue loops on pathological PRs.
    (GHA-C-02 from 2026-04-22 audit.)
    """
    import urllib.request

    out: list[Path] = []
    url: str | None = (
        f"https://api.github.com/repos/{repo}/pulls/{number}/files?per_page=100"
    )
    pages_fetched = 0
    MAX_PAGES = 30

    while url and pages_fetched < MAX_PAGES:
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
            link_header = resp.headers.get("Link", "")
        for e in entries:
            if e.get("status") == "removed":
                continue
            out.append(workspace / e["filename"])
        url = _parse_next_link(link_header)
        pages_fetched += 1

    if url is not None:
        # We stopped early because we hit MAX_PAGES. Log a warning so
        # the PR author knows the lint coverage is partial.
        print(
            f"warning: PR has >{MAX_PAGES * 100} changed files; "
            f"ContentRX linted the first {len(out)} and stopped.",
            file=sys.stderr,
        )

    return out


def _parse_next_link(link_header: str) -> str | None:
    """Extract the `rel=\"next\"` URL from a GitHub Link header.

    Example value:
      <https://api.github.com/...?page=2>; rel="next", <...>; rel="last"
    """
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


def run_ast_extractor(files: list[Path], workspace: Path) -> list[Extraction]:
    """Invoke the Node extractor over JSX/TSX/JS/TS files. Returns [] if the
    binary isn't available (local dev run outside the Docker image)."""
    if not files:
        return []
    if not Path(AST_EXTRACTOR).exists():
        # Local dev: fall back to the regex extractor so tests/one-off
        # runs work without a Node install. Docker runs will always
        # have the extractor at /action/src/extract.mjs.
        print(
            f"warning: {AST_EXTRACTOR} not found; using regex fallback",
            file=sys.stderr,
        )
        return _regex_fallback(files)

    cmd = ["node", AST_EXTRACTOR, *[str(p) for p in files]]
    env = os.environ.copy()
    env["GITHUB_WORKSPACE"] = str(workspace)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        print("error: AST extractor timed out", file=sys.stderr)
        return []
    except FileNotFoundError:
        # `node` isn't on PATH — also a local-dev signal.
        print("warning: node not found; using regex fallback", file=sys.stderr)
        return _regex_fallback(files)

    if result.returncode != 0:
        print(
            f"warning: AST extractor exited {result.returncode}: "
            f"{result.stderr[:500]}",
            file=sys.stderr,
        )
    if result.stderr:
        # Surface per-file parse warnings without blowing up the run.
        sys.stderr.write(result.stderr)

    out: list[Extraction] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        out.append(
            Extraction(
                text=str(record.get("text", "")),
                source_file=str(record.get("file", "")),
                line=int(record.get("line", 1)),
                kind=str(record.get("kind", "jsx-text")),
            )
        )
    return out


def _regex_fallback(files: list[Path]) -> list[Extraction]:
    out: list[Extraction] = []
    for p in files:
        try:
            out.extend(extract_strings(p))
        except Exception as err:  # noqa: BLE001
            print(f"warning: could not read {p}: {err}", file=sys.stderr)
    return out


def run_contentrx(text: str, content_type: str, file_path: str | None) -> dict:
    """Call the installed `contentrx` CLI with --json and return parsed output."""
    cmd = [
        "contentrx",
        "--json",
        "--content-type",
        content_type,
        "--source",
        "action",
    ]
    if file_path:
        cmd.extend(["--file-path", file_path])
    cmd.append(text)

    env = os.environ.copy()
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )
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
    by_file: dict[str, list[dict]] = {}
    for ext in extractions:
        response = run_contentrx(ext.text, content_type, ext.source_file)
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

    ast_files = [p for p in matching if p.suffix.lower() in AST_EXTENSIONS]
    html_files = [p for p in matching if p.suffix.lower() in HTML_EXTENSIONS]

    extractions: list[Extraction] = []
    if ast_files:
        extractions.extend(run_ast_extractor(ast_files, workspace))
    if html_files:
        # HTML stays on the regex path for v2 — htmlparser2 upgrade can
        # follow once the JSX AST walker is settled.
        for p in html_files:
            try:
                for e in extract_strings(p):
                    # Normalise source_file to repo-relative so the
                    # comment + file_path column stay consistent with
                    # the Node extractor's output.
                    rel = str(Path(e.source_file).resolve().relative_to(workspace.resolve())) \
                        if Path(e.source_file).exists() else e.source_file
                    extractions.append(
                        Extraction(
                            text=e.text,
                            source_file=rel,
                            line=e.line,
                            kind=e.kind,
                        )
                    )
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
        # Not running in a PR (or missing token). Still useful to print
        # the report so workflow_dispatch runs have something to read.
        print(body)

    _write_output("violations", str(total_violations))
    _write_output("passed", "true" if total_violations == 0 else "false")

    if strict and total_violations > 0:
        return 1
    return 0


def _write_output(name: str, value: str) -> None:
    out_path = os.environ.get("GITHUB_OUTPUT")
    if not out_path:
        return
    with open(out_path, "a", encoding="utf-8") as f:
        f.write(f"{name}={value}\n")


if __name__ == "__main__":
    sys.exit(main())
