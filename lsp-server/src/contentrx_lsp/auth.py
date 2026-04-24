"""Authentication helpers for the ContentRX Language Server.

Mirrors `contentrx-mcp`'s auth module — same env var (`CONTENTRX_API_KEY`),
same dashboard URL, same validation shape. Kept as its own module so the
two packages can evolve independently (different error surfaces, for
instance: MCP clients render errors inline; LSP clients surface them via
`window/showMessage`).
"""

from __future__ import annotations

import os

_DASHBOARD_URL = "https://contentrx.io/dashboard"
_KEY_ENV_VAR = "CONTENTRX_API_KEY"
_API_BASE_ENV_VAR = "CONTENTRX_API_URL"
_DEFAULT_API_BASE = "https://contentrx.io"


class AuthError(Exception):
    """Raised when CONTENTRX_API_KEY is missing or malformed.

    The message is user-facing — the LSP server surfaces it to the
    editor via `window/showMessage` on startup so the user knows to
    fix their env config before diagnostics can flow.
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
            f"Generate a key at {_DASHBOARD_URL} and expose it to your "
            f"editor (via the VS Code ContentRX extension setting or "
            f"your shell's environment)."
        )
    if not raw.startswith("cx_") or len(raw) < 16:
        raise AuthError(
            f"{_KEY_ENV_VAR} does not look like a ContentRX API key "
            f'(expected "cx_<token>"). Re-mint at {_DASHBOARD_URL}.'
        )
    return raw


def get_api_base_url() -> str:
    """Resolve the ContentRX API base URL.

    Production default is `https://contentrx.io`. Override with
    `CONTENTRX_API_URL` for local dev against `npm run dev`. Trailing
    slashes stripped. http:// rejected unless `CONTENTRX_INSECURE_HTTP=1`
    — a typo shouldn't leak the cx_token over plaintext.
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
