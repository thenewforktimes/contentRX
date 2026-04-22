"""Authentication helpers for the ContentRX MCP server.

The server reads `CONTENTRX_API_KEY` from the environment and uses it as
a bearer token on every request to the ContentRX API. This matches the
`contentrx-cli` pattern (CLAUDE.md → "Auth is `CONTENTRX_API_KEY` env
var. No config files, no flags.").

When the key is missing or malformed, tools fail fast with a message
that points the user at the dashboard so they can mint one. The MCP
client (Claude Code, Cursor, …) surfaces the message inline so the user
can fix it without restarting the server.
"""

from __future__ import annotations

import os

_DASHBOARD_URL = "https://content-rx.vercel.app/dashboard"
_KEY_ENV_VAR = "CONTENTRX_API_KEY"
_API_BASE_ENV_VAR = "CONTENTRX_API_URL"
_DEFAULT_API_BASE = "https://content-rx.vercel.app"


class AuthError(Exception):
    """Raised when CONTENTRX_API_KEY is missing or malformed.

    The message is user-facing — MCP clients render it directly into the
    chat. Keep it short, actionable, and link the dashboard.
    """


def get_api_key() -> str:
    """Read CONTENTRX_API_KEY from the environment.

    Raises AuthError with a dashboard link if missing/blank/malformed.
    A well-formed key starts with `cx_` and is at least 16 characters.
    """
    raw = os.environ.get(_KEY_ENV_VAR, "").strip()
    if not raw:
        raise AuthError(
            f"{_KEY_ENV_VAR} is not set. "
            f"Generate a key at {_DASHBOARD_URL} and add it to your "
            f"MCP client's env config (see contentrx-mcp README)."
        )
    if not raw.startswith("cx_") or len(raw) < 16:
        raise AuthError(
            f"{_KEY_ENV_VAR} does not look like a ContentRX API key "
            f'(expected "cx_<token>"). '
            f"Re-mint at {_DASHBOARD_URL}."
        )
    return raw


def get_api_base_url() -> str:
    """Resolve the ContentRX API base URL.

    Production default is `https://content-rx.vercel.app`. Override with
    `CONTENTRX_API_URL` for local development against `npm run dev`.
    Trailing slashes are stripped so callers can append `/api/check`.

    Like the cli-client, http:// is rejected unless the explicit
    `CONTENTRX_INSECURE_HTTP=1` escape is set — a typo'd env var
    shouldn't leak the cx_token over plaintext.
    """
    raw = os.environ.get(_API_BASE_ENV_VAR, "").strip() or _DEFAULT_API_BASE
    base = raw.rstrip("/")
    if not base.startswith("https://"):
        if os.environ.get("CONTENTRX_INSECURE_HTTP") == "1":
            return base
        raise AuthError(
            f"{_API_BASE_ENV_VAR}={base!r} must use https://. "
            f"Set CONTENTRX_INSECURE_HTTP=1 to allow plaintext for "
            f"local dev only."
        )
    return base
