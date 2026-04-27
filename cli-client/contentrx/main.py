"""ContentRX CLI entry point.

Thin HTTPS client for the ContentRX evaluation API. Deliberately ships
with zero third-party dependencies — stdlib only — so `pip install
contentrx-cli` stays fast and the supply-chain surface stays minimal.

Usage:
    CONTENTRX_API_KEY=cx_...  contentrx "Click here"
    CONTENTRX_API_KEY=cx_...  contentrx --json "Click here"
    CONTENTRX_API_KEY=cx_...  contentrx --batch strings.txt
    CONTENTRX_API_KEY=cx_...  contentrx --batch strings.json --json
    CONTENTRX_API_KEY=cx_...  contentrx --content-type button_cta "Save"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable

from . import __version__

DEFAULT_API_URL = "https://contentrx.io"
DEFAULT_TIMEOUT_SECONDS = 60
USER_AGENT = f"contentrx-cli/{__version__}"

MAX_BATCH_FILE_SIZE = 10 * 1024 * 1024  # 10 MB — same ceiling as the engine
SUPPORTED_BATCH_EXTENSIONS = (".json", ".txt")

DASHBOARD_URL = "https://contentrx.io/dashboard"


# ---------------------------------------------------------------------------
# Exit codes — stable so CI configs can pin on them.
# ---------------------------------------------------------------------------
EXIT_OK = 0
EXIT_VIOLATIONS = 1    # Normal "content failed the check" exit
EXIT_USAGE = 2         # Argparse / user error
EXIT_AUTH = 3          # 401 / missing key
EXIT_QUOTA = 4         # 402
EXIT_RATELIMIT = 5     # 429
EXIT_UPSTREAM = 6      # 5xx / network errors


class CliError(Exception):
    """Raised when the CLI wants to print a clean message and exit non-zero."""

    def __init__(self, message: str, code: int = EXIT_UPSTREAM) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# API client
# ---------------------------------------------------------------------------
def _api_base_url() -> str:
    """Resolve the API base URL, enforcing HTTPS.

    Plain-HTTP URLs send the cx_ API key in cleartext. Most users will
    never touch CONTENTRX_API_URL; the ones who do (self-hosted,
    staging) are overwhelmingly on https. We guard the common mistake
    (pasting http:// instead of https://) while leaving an escape hatch
    for hitting a local dev server on http://localhost. (CLI-M-01 from
    2026-04-22 audit.)
    """
    raw = os.environ.get("CONTENTRX_API_URL", DEFAULT_API_URL).rstrip("/")
    if raw.startswith("https://"):
        return raw
    if os.environ.get("CONTENTRX_INSECURE_HTTP") == "1":
        return raw
    raise CliError(
        "CONTENTRX_API_URL must start with https://. "
        "If you intentionally want to hit a local dev server over http, "
        "set CONTENTRX_INSECURE_HTTP=1 to opt in.",
        code=EXIT_USAGE,
    )


def _read_api_key() -> str:
    key = os.environ.get("CONTENTRX_API_KEY", "").strip()
    if not key:
        raise CliError(
            "CONTENTRX_API_KEY is not set. Generate a key at "
            f"{DASHBOARD_URL} and export it:\n"
            "  export CONTENTRX_API_KEY=cx_...",
            code=EXIT_AUTH,
        )
    return key


def check_text(
    text: str,
    *,
    content_type: str | None = None,
    moment: str | None = None,
    audience: str | None = None,
    source: str = "cli",
    file_path: str | None = None,
    api_url: str | None = None,
    api_key: str | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """POST to /api/check and return the parsed JSON response."""
    payload: dict[str, Any] = {"text": text, "source": source}
    if content_type:
        payload["content_type"] = content_type
    if moment:
        payload["moment"] = moment
    if audience:
        payload["audience"] = audience
    if file_path:
        payload["file_path"] = file_path

    base = api_url or _api_base_url()
    url = f"{base}/api/check"
    body = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key or _read_api_key()}",
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as err:
        _reraise_http(err)
    except urllib.error.URLError as err:
        raise CliError(
            f"Can't reach ContentRX at {base}. Check your internet connection "
            f"or the CONTENTRX_API_URL override. ({err.reason})",
            code=EXIT_UPSTREAM,
        ) from err


def _reraise_http(err: urllib.error.HTTPError) -> None:
    """Translate HTTP errors into typed CliErrors with actionable messages."""
    body_text = ""
    try:
        body_text = err.read().decode("utf-8")
    except Exception:
        body_text = ""

    parsed: dict[str, Any] = {}
    if body_text:
        try:
            parsed = json.loads(body_text)
        except json.JSONDecodeError:
            parsed = {}

    if err.code == 401:
        raise CliError(
            "Your API key was rejected. Generate or rotate it at "
            f"{DASHBOARD_URL}.",
            code=EXIT_AUTH,
        ) from err
    if err.code == 402:
        quota = parsed.get("quota")
        reset = parsed.get("resets_at")
        detail = f" ({quota} scans/month, resets {reset})" if quota else ""
        raise CliError(
            f"Monthly quota exhausted{detail}. Upgrade at {DASHBOARD_URL}.",
            code=EXIT_QUOTA,
        ) from err
    if err.code == 429:
        reset = parsed.get("reset_at")
        tail = f" (retry after {reset})" if reset else ""
        raise CliError(
            f"Rate limit exceeded{tail}. Slow down and try again.",
            code=EXIT_RATELIMIT,
        ) from err
    if err.code == 400:
        msg = parsed.get("error") or "Invalid request"
        raise CliError(f"{msg}.", code=EXIT_USAGE) from err

    # Opaque 5xx fallback. We don't surface backend stack traces.
    raise CliError(
        f"ContentRX returned HTTP {err.code}. Try again in a few minutes.",
        code=EXIT_UPSTREAM,
    ) from err


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def print_result(
    text: str,
    response: dict[str, Any],
    *,
    verbose: bool,
    stream=None,
) -> bool:
    """Render a single result; returns True if it passed.

    Three-state verdict (v1.1.0+, BUILD_PLAN_v2 Session 10):
      pass               → green ✓
      violation          → red ✗
      review_recommended → yellow ⚠ (printed as "REVIEW")
      error              → red ✗ (treated like a violation for output)

    REVIEW does NOT count as a failure for the return value — CI runners
    that wrap this CLI and exit on `passed=False` only fail on hard
    violations. To fail on REVIEW too, use the GitHub Action's
    `fail-on: review` input.
    """
    stream = stream or sys.stdout
    # Schema 2.0.0 (ADR 2026-04-25). The /api/check response carries
    # `verdict`, `review_reason`, `violations`, and `warnings` at the
    # top level — no `result` wrapper, no `moment`, `content_type`,
    # `summary`, or `rationale_chain` (those are substrate). Each
    # violation has `issue`, `suggestion`, `severity`, `confidence`.
    verdict = response.get("verdict") or "pass"
    review_reason = response.get("review_reason")
    if verdict == "pass":
        icon, color, label = "✓", "\033[32m", "PASS"
    elif verdict == "review_recommended":
        icon, color, label = "⚠", "\033[33m", "REVIEW"
    else:  # violation, error
        icon, color, label = "✗", "\033[31m", verdict.upper()
    reset = "\033[0m"
    use_color = _stream_supports_color(stream)

    verdict_line = f"{icon} {label}"
    if use_color:
        verdict_line = f"{color}{verdict_line}{reset}"
    print(f"\n{verdict_line}", file=stream)
    if verdict == "review_recommended" and review_reason:
        print(f"  Reason: {review_reason}", file=stream)

    violations = response.get("violations", []) or []
    if violations:
        print(f"\n  Violations ({len(violations)}):", file=stream)
        for v in violations:
            severity = (v.get("severity") or "medium").upper()
            issue = v.get("issue", "")
            print(f"    - [{severity}] {issue}", file=stream)
            if v.get("suggestion"):
                print(f"        suggestion: {v['suggestion']}", file=stream)

    if verbose:
        usage = response.get("usage", {}) or {}
        if usage:
            used = usage.get("used")
            quota = usage.get("quota")
            print(f"\n  Usage: {used} of {quota} this month", file=stream)
        lat = response.get("latency_ms")
        if lat is not None:
            print(f"  Latency: {lat} ms", file=stream)

    # REVIEW counts as "passed" for exit-code purposes — REVIEW means
    # "look at this," not "this is wrong." Hard violations still fail.
    return verdict in ("pass", "review_recommended")


def _stream_supports_color(stream) -> bool:
    # Respect NO_COLOR (https://no-color.org/) and CI without TTY.
    if os.environ.get("NO_COLOR"):
        return False
    try:
        return hasattr(stream, "isatty") and stream.isatty()
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Batch loader — mirrors engine CLI behavior for .txt and .json inputs.
# ---------------------------------------------------------------------------
def load_batch_file(path: Path) -> list[dict[str, Any]]:
    """Read a batch file into a list of { text, content_type?, moment?, audience? }."""
    if not path.exists():
        raise CliError(f"Batch file not found: {path}", code=EXIT_USAGE)
    if path.suffix not in SUPPORTED_BATCH_EXTENSIONS:
        raise CliError(
            f"Unsupported batch file extension: {path.suffix}. "
            f"Use one of: {', '.join(SUPPORTED_BATCH_EXTENSIONS)}",
            code=EXIT_USAGE,
        )
    if path.stat().st_size > MAX_BATCH_FILE_SIZE:
        raise CliError(
            f"Batch file too large ({path.stat().st_size} bytes). "
            f"Max is {MAX_BATCH_FILE_SIZE}.",
            code=EXIT_USAGE,
        )

    raw = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        return _parse_json_batch(raw)
    return _parse_txt_batch(raw)


def _parse_txt_batch(raw: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        items.append({"text": stripped})
    if not items:
        raise CliError("Batch file is empty.", code=EXIT_USAGE)
    return items


def _parse_json_batch(raw: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        raise CliError(f"Batch JSON is malformed: {err}", code=EXIT_USAGE) from err

    if not isinstance(data, list):
        raise CliError(
            "Batch JSON must be a list of { text, ... } objects.",
            code=EXIT_USAGE,
        )

    out: list[dict[str, Any]] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict) or "text" not in item:
            raise CliError(
                f"Batch item {i}: missing required 'text' field.",
                code=EXIT_USAGE,
            )
        entry: dict[str, Any] = {"text": str(item["text"])}
        for key in ("content_type", "moment", "audience", "file_path"):
            if item.get(key):
                entry[key] = str(item[key])
        out.append(entry)
    if not out:
        raise CliError("Batch file is empty.", code=EXIT_USAGE)
    return out


# ---------------------------------------------------------------------------
# Argparse dispatch
# ---------------------------------------------------------------------------
def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="contentrx",
        description=(
            "ContentRX CLI — check UI copy against the ContentRX content "
            "standards. Requires CONTENTRX_API_KEY. Generate one at "
            f"{DASHBOARD_URL}."
        ),
    )
    parser.add_argument("text", nargs="?", help="Text to check (omit with --batch)")
    parser.add_argument(
        "--batch",
        type=Path,
        metavar="FILE",
        help="Batch mode: path to .txt (one string per line) or .json "
        "(list of { text, content_type?, moment?, audience? }) file.",
    )
    parser.add_argument(
        "--content-type",
        help="Hint the content type (e.g. button_cta, error_message, tooltip_microcopy).",
    )
    parser.add_argument(
        "--moment",
        help="Hint the moment (e.g. confirmation, decision_point).",
    )
    parser.add_argument(
        "--audience",
        help="Hint the audience (product_ui or general).",
    )
    parser.add_argument(
        "--file-path",
        dest="file_path",
        help="Repository-relative source-file path. Attached to each "
        "violation and surfaced in the team analytics 'Top files' panel.",
    )
    parser.add_argument(
        "--source",
        choices=["plugin", "cli", "action", "ditto"],
        default="cli",
        help="Client source tag stored alongside violations (default: cli).",
    )
    parser.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        help="Emit the raw ContentRX JSON response.",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Include latency and quota usage.",
    )
    parser.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="Only valid with --batch. Print how many checks the batch "
        "would consume and exit without calling the API. Useful for "
        "estimating quota use before running an audit.",
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Skip the pre-batch confirmation prompt. Required for "
        "non-interactive shells that should run --batch without a "
        "yes/no input.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    return parser


def run(argv: list[str]) -> int:
    # Human-eval build plan Session 30 PR B — `contentrx example …`
    # subcommand group. Intercepted BEFORE argparse so the main
    # parser's positional `text` doesn't consume "example" as input.
    # Keeps the single-string muscle memory (`contentrx "hello"`)
    # working while adding the new command group.
    if argv and argv[0] == "example":
        return _run_example_subcommand(argv[1:])

    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.batch is None and not args.text:
        parser.error("Provide TEXT or --batch FILE.")

    if args.batch is not None and args.text:
        parser.error("Provide TEXT or --batch FILE, not both.")

    if args.dry_run and args.batch is None:
        parser.error("--dry-run only makes sense with --batch.")

    # Environment-driven config resolved once; propagated down so tests
    # can override by setting env before calling run().
    api_key = _read_api_key()
    api_url = _api_base_url()

    if args.batch is not None:
        items = load_batch_file(args.batch)
        if args.dry_run:
            return _print_dry_run_estimate(len(items))
        if not _confirm_proceed(len(items), yes=args.yes):
            print("Cancelled.", file=sys.stderr)
            return EXIT_OK
        return _run_batch(
            items,
            json_output=args.json_output,
            verbose=args.verbose,
            api_key=api_key,
            api_url=api_url,
            content_type=args.content_type,
            moment=args.moment,
            audience=args.audience,
            file_path=args.file_path,
            source=args.source,
        )

    response = check_text(
        args.text,
        content_type=args.content_type,
        moment=args.moment,
        audience=args.audience,
        file_path=args.file_path,
        source=args.source,
        api_url=api_url,
        api_key=api_key,
    )
    if args.json_output:
        json.dump(response, sys.stdout, indent=2)
        print()
        # Schema 2.0.0 — verdict is at the top level, no `result` wrapper.
        passed = response.get("verdict") in ("pass", "review_recommended")
    else:
        passed = print_result(args.text, response, verbose=args.verbose)

    return EXIT_OK if passed else EXIT_VIOLATIONS


def _run_batch(
    items: Iterable[dict[str, Any]],
    *,
    json_output: bool,
    verbose: bool,
    api_key: str,
    api_url: str,
    content_type: str | None,
    moment: str | None,
    audience: str | None,
    file_path: str | None,
    source: str,
) -> int:
    all_passed = True
    collected: list[dict[str, Any]] = []
    for item in items:
        response = check_text(
            item["text"],
            content_type=item.get("content_type") or content_type,
            moment=item.get("moment") or moment,
            audience=item.get("audience") or audience,
            file_path=item.get("file_path") or file_path,
            source=source,
            api_url=api_url,
            api_key=api_key,
        )
        if json_output:
            collected.append({"input": item, "response": response})
        else:
            passed = print_result(item["text"], response, verbose=verbose)
            all_passed = all_passed and passed
        if json_output:
            # Schema 2.0.0 — verdict is at the top level.
            verdict = response.get("verdict")
            all_passed = all_passed and (
                verdict in ("pass", "review_recommended")
            )
    if json_output:
        json.dump(collected, sys.stdout, indent=2)
        print()
    return EXIT_OK if all_passed else EXIT_VIOLATIONS


def _print_dry_run_estimate(count: int) -> int:
    """Print the would-be check count and exit cleanly. PR-13: the
    dry-run gate. Goes to stdout so pipelines can capture it; status
    code is EXIT_OK because nothing failed — the user explicitly
    asked for a count, not a check."""
    word = "check" if count == 1 else "checks"
    print(f"{count} {word} would be sent (dry-run; no API calls made).")
    return EXIT_OK


def _confirm_proceed(count: int, *, yes: bool) -> bool:
    """Pre-batch confirmation prompt (PR-13).

    The dry-run pattern from the customer-experience design doc: every
    surface that can run more than ~10 checks at once needs a pre-action
    gate. For the CLI specifically:

      - `--yes` always skips (CI use).
      - Non-TTY stdin → assume yes + print the count to stderr so it
        shows up in pipeline logs (backward-compat: pre-PR-13 CI
        scripts using `--batch` keep working).
      - TTY → prompt. Default Y (Enter accepts).

    Returns True to proceed, False to cancel.
    """
    if yes:
        return True
    word = "check" if count == 1 else "checks"
    if not sys.stdin.isatty():
        print(
            f"Running {count} {word} (use --yes to silence this notice).",
            file=sys.stderr,
        )
        return True
    prompt = f"Run {count} {word}? [Y/n] "
    try:
        response = input(prompt).strip().lower()
    except EOFError:
        return False
    return response in ("", "y", "yes")


def _run_example_subcommand(argv: list[str]) -> int:
    """Dispatch `contentrx example …` (Session 30 PR B).

    Builds a mini-parser for the subcommand group and delegates to
    `example_cmd.dispatch`. Kept separate from `_build_parser` so the
    main-CLI muscle memory (`contentrx "string"`) stays unchanged.
    """
    from . import example_cmd

    parser = argparse.ArgumentParser(
        prog="contentrx example",
        description=(
            "Manage team custom examples. Admin-only, Team-plan feature. "
            "See https://docs.contentrx.io/guides/custom-examples for the "
            "full workflow."
        ),
    )
    sub = parser.add_subparsers(dest="example_command", required=True)
    example_cmd.add_subparsers(sub)
    args = parser.parse_args(argv)

    api_key = _read_api_key()
    api_url = _api_base_url()
    try:
        return example_cmd.dispatch(args, api_url=api_url, api_key=api_key)
    except example_cmd._CliError as err:
        raise CliError(str(err), code=err.code) from err


def main(argv: list[str] | None = None) -> int:
    try:
        return run(argv if argv is not None else sys.argv[1:])
    except CliError as err:
        print(f"error: {err}", file=sys.stderr)
        return err.code
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main())
