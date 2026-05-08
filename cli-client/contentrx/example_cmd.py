"""`contentrx example …` subcommand group.

Human-eval build plan Session 30 PR B. Thin stdlib-only wrapper over
`/api/team-custom-examples` so the team admin can curate the custom-
example set from the terminal — MCP-first, CLI-second per the
generation-layer positioning (Session 29).

Usage:

    contentrx example add "Let's go." --verdict pass --moment confirmation \
        --notes "Intentional conversational voice on confirmations"
    contentrx example list
    contentrx example list --json | jq '.examples[] | .text'
    contentrx example search "Let's go."
    contentrx example remove <id>
    contentrx example import examples.json
    contentrx example export > backup.json

Kept in its own module so the main.py hot path stays readable; every
subcommand here is a thin urllib POST/GET/DELETE wrapper plus format
glue.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from .display_labels import display_label_for

_EXAMPLES_PATH = "/api/team-custom-examples"


class _CliError(Exception):
    """Local mirror of cli-client's CliError — defined here so this
    module doesn't import from main at module load. main wraps this
    back into its own CliError in the command dispatcher.
    """

    def __init__(self, message: str, code: int = 6) -> None:
        super().__init__(message)
        self.code = code


def _http(
    method: str,
    path: str,
    *,
    api_url: str,
    api_key: str,
    body: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    """Minimal stdlib HTTP. Returns the parsed JSON body. Raises
    `_CliError` with a user-facing message on 4xx/5xx.
    """
    url = f"{api_url.rstrip('/')}{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    data: bytes | None = None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": f"contentrx-cli/{_cli_version()}",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8"))
        except Exception:
            detail = {"error": exc.reason}
        message = detail.get("error") or exc.reason
        code = 3 if exc.code in (401, 403) else 4 if exc.code == 402 else 5 if exc.code == 429 else 6
        raise _CliError(f"{message} (HTTP {exc.code})", code=code) from exc
    except urllib.error.URLError as exc:
        raise _CliError(f"Network error: {exc.reason}", code=6) from exc


def _cli_version() -> str:
    from . import __version__
    return __version__


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------


def cmd_add(args: argparse.Namespace, *, api_url: str, api_key: str) -> int:
    body: dict[str, Any] = {
        "text": args.text,
        "verdict": args.verdict,
        "contribute_upstream": args.contribute_upstream,
    }
    if args.moment:
        body["moment"] = args.moment
    if args.content_type:
        body["content_type"] = args.content_type
    if args.standard_id:
        body["standard_id"] = args.standard_id
    if args.notes:
        body["notes"] = args.notes

    resp = _http("POST", _EXAMPLES_PATH, api_url=api_url, api_key=api_key, body=body)
    entry = (resp.get("result") or {}).get("example") or {}

    if args.json_output:
        json.dump(entry, sys.stdout, indent=2)
        print()
    else:
        print(f"✓ Added custom example {entry.get('id')}: {_format_entry_oneline(entry)}")
    return 0


def cmd_list(args: argparse.Namespace, *, api_url: str, api_key: str) -> int:
    params: dict[str, str] = {}
    if args.limit:
        params["limit"] = str(args.limit)
    resp = _http("GET", _EXAMPLES_PATH, api_url=api_url, api_key=api_key, params=params or None)
    result = resp.get("result") or {}
    examples = result.get("examples") or []

    if args.json_output:
        json.dump({"examples": examples, "count": result.get("count", 0), "cap": result.get("cap", 0)}, sys.stdout, indent=2)
        print()
        return 0

    count = result.get("count", 0)
    cap = result.get("cap", 0)
    if not examples:
        print("(no custom examples yet)")
        return 0
    print(f"{count} of {cap} custom examples:")
    for e in examples:
        print(f"  {e.get('id'):<24}  {e.get('verdict'):<10}  {_format_entry_oneline(e)}")
    return 0


def cmd_search(args: argparse.Namespace, *, api_url: str, api_key: str) -> int:
    resp = _http(
        "GET",
        _EXAMPLES_PATH,
        api_url=api_url,
        api_key=api_key,
        params={"text": args.text},
    )
    result = resp.get("result") or {}
    examples = result.get("examples") or []
    if args.json_output:
        json.dump({"covered": len(examples) > 0, "examples": examples}, sys.stdout, indent=2)
        print()
        return 0
    if not examples:
        print(f"No custom example covers \"{args.text}\".")
        return 0
    for e in examples:
        print(f"✓ Covered by {e.get('id')}: {_format_entry_oneline(e)}")
    return 0


def cmd_remove(args: argparse.Namespace, *, api_url: str, api_key: str) -> int:
    _http(
        "DELETE",
        f"{_EXAMPLES_PATH}/{args.id}",
        api_url=api_url,
        api_key=api_key,
    )
    print(f"✓ Removed {args.id}.")
    return 0


def cmd_export(args: argparse.Namespace, *, api_url: str, api_key: str) -> int:
    """Dump every custom example as JSON to stdout. Pipe to a file to
    check the team's set into source control.
    """
    resp = _http(
        "GET",
        _EXAMPLES_PATH,
        api_url=api_url,
        api_key=api_key,
        params={"limit": "500"},
    )
    result = resp.get("result") or {}
    examples = result.get("examples") or []
    # Keep just the fields an `import` pass needs — strip ids +
    # timestamps so the export is round-trippable without
    # importing the same id twice.
    cleaned = [
        {
            "text": e.get("text"),
            "verdict": e.get("verdict"),
            "moment": e.get("moment"),
            "content_type": e.get("contentType") or e.get("content_type"),
            "standard_id": e.get("standardId") or e.get("standard_id"),
            "notes": e.get("notes"),
            "contribute_upstream": bool(e.get("contributeUpstream") or e.get("contribute_upstream") or False),
        }
        for e in examples
    ]
    json.dump({"schema_version": "1.0.0", "examples": cleaned}, sys.stdout, indent=2)
    print()
    return 0


def cmd_import(args: argparse.Namespace, *, api_url: str, api_key: str) -> int:
    """Bulk add entries from a JSON file produced by `export`. Stops
    on the first error and reports which entry failed so the admin
    can fix + re-run.
    """
    path = Path(args.file)
    if not path.exists():
        raise _CliError(f"Import file not found: {path}", code=2)
    raw = json.loads(path.read_text(encoding="utf-8"))
    entries = raw.get("examples") if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        raise _CliError(
            "Invalid import file: expected {\"examples\": [...]} or [...].",
            code=2,
        )

    added = 0
    skipped = 0
    for i, entry in enumerate(entries, start=1):
        body: dict[str, Any] = {
            k: v
            for k, v in entry.items()
            if v is not None and k in {
                "text",
                "verdict",
                "moment",
                "content_type",
                "standard_id",
                "notes",
                "contribute_upstream",
            }
        }
        if "contribute_upstream" not in body:
            body["contribute_upstream"] = False
        try:
            _http("POST", _EXAMPLES_PATH, api_url=api_url, api_key=api_key, body=body)
            added += 1
        except _CliError as exc:
            msg = str(exc)
            if "already exists" in msg and not args.strict:
                skipped += 1
                continue
            raise _CliError(
                f"Failed on entry #{i} (text={entry.get('text', '')[:40]!r}): {msg}",
                code=exc.code,
            )

    print(f"✓ Imported {added} entries (skipped {skipped} duplicates).")
    return 0


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def _format_entry_oneline(entry: dict[str, Any]) -> str:
    text = entry.get("text") or ""
    shown = text if len(text) <= 60 else text[:57] + "…"
    bits: list[str] = [repr(shown)]
    moment = entry.get("moment")
    content_type = entry.get("contentType") or entry.get("content_type")
    standard_id = entry.get("standardId") or entry.get("standard_id")
    if moment:
        bits.append(f"moment={moment}")
    if content_type:
        bits.append(f"type={content_type}")
    if standard_id:
        # Substrate IDs (GRM-04, ACC-07, …) are private per ADR
        # 2026-04-25; render the customer-facing display label
        # instead. Custom rules (TEAM-NN) pass through unchanged.
        bits.append(f"label={display_label_for(standard_id)}")
    return " · ".join(bits)


# ---------------------------------------------------------------------------
# Parser wiring
# ---------------------------------------------------------------------------


def add_subparsers(example_sub: argparse._SubParsersAction) -> None:
    """Attach the individual `example` leaf commands (add / list / …)
    to the provided subparsers action. The caller owns the group
    parser so `contentrx example add` resolves without a double
    `example example …` path.
    """
    add_p = example_sub.add_parser("add", help="Add a custom example.")
    add_p.add_argument("text", help="The exact string to short-circuit on.")
    add_p.add_argument(
        "--verdict",
        choices=["pass", "violation"],
        required=True,
        help="Whether the string should short-circuit to pass or violation.",
    )
    add_p.add_argument("--moment", help="Scope the match to this moment only.")
    add_p.add_argument("--content-type", dest="content_type", help="Scope the match to this content_type only.")
    add_p.add_argument("--standard-id", dest="standard_id", help="Required for --verdict violation.")
    add_p.add_argument("--notes", help="Admin-authored rationale (≤1000 chars).")
    add_p.add_argument(
        "--contribute-upstream",
        dest="contribute_upstream",
        action="store_true",
        help="Opt this example into anonymised contribution to the ContentRX core model.",
    )
    add_p.add_argument("--json", dest="json_output", action="store_true")

    list_p = example_sub.add_parser("list", help="List the team's custom examples.")
    list_p.add_argument("--limit", type=int, default=None)
    list_p.add_argument("--json", dest="json_output", action="store_true")

    search_p = example_sub.add_parser("search", help="Check whether a string is covered.")
    search_p.add_argument("text")
    search_p.add_argument("--json", dest="json_output", action="store_true")

    remove_p = example_sub.add_parser("remove", help="Remove a custom example by id.")
    remove_p.add_argument("id")

    export_p = example_sub.add_parser("export", help="Dump all entries as JSON to stdout.")
    # Export has no flags of its own today; the --json default is
    # the only output format. Reserved for future pagination.

    import_p = example_sub.add_parser("import", help="Bulk add from a JSON file.")
    import_p.add_argument("file", help="Path to a JSON file produced by `export`.")
    import_p.add_argument(
        "--strict",
        action="store_true",
        help="Fail on duplicate entries instead of skipping them.",
    )


def dispatch(args: argparse.Namespace, *, api_url: str, api_key: str) -> int:
    """Route `contentrx example <cmd> …` to the right handler."""
    handlers = {
        "add": cmd_add,
        "list": cmd_list,
        "search": cmd_search,
        "remove": cmd_remove,
        "export": cmd_export,
        "import": cmd_import,
    }
    handler = handlers.get(args.example_command)
    if handler is None:
        raise _CliError(
            f"Unknown example subcommand: {args.example_command}",
            code=2,
        )
    return handler(args, api_url=api_url, api_key=api_key)


__all__ = [
    "add_subparsers",
    "dispatch",
    "_CliError",
]
