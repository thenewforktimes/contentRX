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
    result = response.get("result", {})
    # Prefer the new three-state verdict; fall back to overall_verdict
    # for older API versions that haven't shipped the v1.1.0 envelope.
    verdict = result.get("verdict") or result.get("overall_verdict", "pass")
    review_reason = result.get("review_reason")
    if verdict == "pass":
        icon, color, label = "✓", "\033[32m", "PASS"
    elif verdict == "review_recommended":
        icon, color, label = "⚠", "\033[33m", "REVIEW"
    else:  # violation, fail, error
        icon, color, label = "✗", "\033[31m", verdict.upper()
    reset = "\033[0m"
    use_color = _stream_supports_color(stream)

    verdict_line = f"{icon} {label}"
    if use_color:
        verdict_line = f"{color}{verdict_line}{reset}"
    print(f"\n{verdict_line}", file=stream)
    if verdict == "review_recommended" and review_reason:
        print(f"  Reason: {review_reason}", file=stream)
    print(f"  Content type: {result.get('content_type', 'unknown')}", file=stream)
    # Human-eval build plan Session 22 — surface the detected moment on
    # every verdict, above the violations. The plan's language: "I
    # noticed this looks like a destructive_action." Suppress the
    # default browsing_discovery to avoid a noisy line on every call.
    moment = result.get("moment") or ""
    if moment and moment != "browsing_discovery":
        counts = _moment_weight_suffix(moment)
        print(f"  Moment: {moment}{counts}", file=stream)
    if result.get("summary"):
        print(f"  {result['summary']}", file=stream)

    violations = result.get("violations", []) or []
    if violations:
        print(f"\n  Violations ({len(violations)}):", file=stream)
        for v in violations:
            print(
                f"    - {v.get('standard_id', '?')}: {v.get('issue', '')}",
                file=stream,
            )
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


# Human-eval build plan Session 22 — "Moment detected" weights summary
# surfaced in the CLI's default output. Hand-mirrored counts from
# src/content_checker/moments.py :: MOMENT_WEIGHTS. Only non-zero
# counts are surfaced so silent moments stay quiet.
_MOMENT_WEIGHT_COUNTS: dict[str, tuple[int, int, int]] = {
    # (emphasized, relaxed, suppressed)
    "first_encounter":    (4, 1, 0),
    "browsing_discovery": (0, 1, 1),
    "decision_point":     (4, 0, 1),
    "task_execution":     (4, 0, 0),
    "confirmation":       (0, 2, 0),
}


def _moment_weight_suffix(moment: str) -> str:
    """Return a parenthesised counts suffix for the moment line.

    Example: "  Moment: decision_point (4 emphasized, 1 suppressed)"
    Empty string when the moment has no weighted standards. The CLI is
    plain-ASCII and line-oriented; this keeps the signal tight.
    """
    counts = _MOMENT_WEIGHT_COUNTS.get(moment)
    if not counts:
        return ""
    emp, rel, sup = counts
    parts: list[str] = []
    if emp:
        parts.append(f"{emp} emphasized")
    if rel:
        parts.append(f"{rel} relaxed")
    if sup:
        parts.append(f"{sup} suppressed")
    if not parts:
        return ""
    return f" ({', '.join(parts)})"


def print_rationale_chain(response: dict[str, Any], stream=None) -> None:
    """Render the pipeline rationale_chain as a plaintext tree.

    Human-eval build plan Session 21. Prints beneath the normal verdict
    block when `--explain` is passed. No color codes — plain ASCII is
    friendlier in CI logs.

    Empty chain is a no-op (older API responses, unit-test direct
    CheckResult construction). Missing chain is also a no-op — we
    treat the field as optional by design so pre-v1.2.0 servers still
    get a clean CLI experience.
    """
    stream = stream or sys.stdout
    result = response.get("result", {})
    chain = result.get("rationale_chain") or []
    if not chain:
        return

    print("\n  Rationale chain:", file=stream)
    for i, hop in enumerate(chain):
        step = hop.get("step", "?")
        confidence = hop.get("confidence")
        suffix = ""
        if isinstance(confidence, (int, float)):
            suffix = f" · {int(round(confidence * 100))}%"
        flag = hop.get("ambiguity_flag")
        if flag:
            suffix += f" · flag={flag}"
        print(f"    {i + 1}. {step}{suffix}", file=stream)

        output = hop.get("output") or {}
        if output:
            for key, val in output.items():
                print(f"         {key}: {val}", file=stream)
        rule_versions = hop.get("rule_versions") or {}
        if rule_versions:
            entries = ", ".join(
                f"{std}=v{ver}" for std, ver in rule_versions.items()
            )
            print(f"         rules: {entries}", file=stream)


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
        "--explain",
        action="store_true",
        help=(
            "Print the rationale chain after the verdict — every pipeline "
            "hop with its confidence, rule versions, and ambiguity flags. "
            "Useful for debugging why a string was flagged."
        ),
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    return parser


def run(argv: list[str]) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.batch is None and not args.text:
        parser.error("Provide TEXT or --batch FILE.")

    if args.batch is not None and args.text:
        parser.error("Provide TEXT or --batch FILE, not both.")

    # Environment-driven config resolved once; propagated down so tests
    # can override by setting env before calling run().
    api_key = _read_api_key()
    api_url = _api_base_url()

    if args.batch is not None:
        items = load_batch_file(args.batch)
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
        passed = response.get("result", {}).get("overall_verdict") == "pass"
    else:
        passed = print_result(args.text, response, verbose=args.verbose)
        if args.explain:
            print_rationale_chain(response)

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
            verdict = response.get("result", {}).get("overall_verdict")
            all_passed = all_passed and (verdict == "pass")
    if json_output:
        json.dump(collected, sys.stdout, indent=2)
        print()
    return EXIT_OK if all_passed else EXIT_VIOLATIONS


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
