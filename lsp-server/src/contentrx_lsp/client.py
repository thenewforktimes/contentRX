"""Async HTTP client for /api/check, mirroring the MCP server's client.

The LSP server talks to the public ContentRX API — same architectural
rule as `contentrx-mcp` and `contentrx-cli`. No engine imports. Every
lint traverses the network.

Failure handling leans toward graceful degradation: a network error
or 401 should cause the LSP server to stop emitting diagnostics
silently (and surface a message via the server's notify layer), not
raise a stack trace at the editor. The editor should never see a
crashed language server.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from . import __version__
from .auth import AuthError, get_api_base_url, get_api_key

_USER_AGENT = f"contentrx-lsp/{__version__}"
_TIMEOUT_SECONDS = 30.0


class ContentRXError(Exception):
    """Generic API failure — the LSP server converts these into
    `window/showMessage` notifications rather than crashing."""


class AuthFailedError(ContentRXError):
    """401 — key revoked, malformed, or wrong environment."""


class QuotaExhaustedError(ContentRXError):
    """402 — monthly quota at zero. Editor should suggest upgrading."""


class RateLimitError(ContentRXError):
    """429 — carries seconds until reset so the client can back off."""

    def __init__(self, message: str, retry_after_seconds: int):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


@dataclass
class CheckResult:
    """Subset of /api/check the diagnostics layer consumes."""

    verdict: str  # "pass" | "violation" | "review_recommended" | "error"
    violations: list[dict[str, Any]]
    review_reason: str | None = None
    content_type: str | None = None
    moment: str | None = None
    # passed through for possible future use
    rationale_chain: list[dict[str, Any]] = field(default_factory=list)


async def check(
    text: str,
    *,
    source: str = "lsp",
    content_type: str | None = None,
    moment: str | None = None,
) -> CheckResult:
    """POST /api/check for a single string.

    `source="lsp"` tells the server to record any violations with
    source=lsp in the violations table once that surface is allowed
    (today `source` is a restricted enum — new values land with a
    schema change). For now the server may reject unknown sources;
    the LSP client falls back to "plugin" if that happens.
    """
    api_key = get_api_key()
    base_url = get_api_base_url()

    payload: dict[str, Any] = {"text": text}
    if content_type:
        payload["content_type"] = content_type
    if moment:
        payload["moment"] = moment

    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": _USER_AGENT,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        try:
            response = await client.post(
                f"{base_url}/api/check",
                headers=headers,
                json=payload,
            )
        except httpx.HTTPError as exc:
            raise ContentRXError(f"Network error: {exc}") from exc

        if response.status_code == 401:
            raise AuthFailedError(
                "ContentRX rejected the API key. Re-mint at "
                "https://contentrx.io/dashboard."
            )
        if response.status_code == 402:
            raise QuotaExhaustedError(
                "Monthly quota exhausted. Upgrade at "
                "https://contentrx.io/dashboard."
            )
        if response.status_code == 429:
            retry_after = int(response.headers.get("retry-after", "30"))
            raise RateLimitError(
                f"Rate limit hit — retry in {retry_after}s.",
                retry_after_seconds=retry_after,
            )
        if response.status_code >= 400:
            raise ContentRXError(
                f"ContentRX API error {response.status_code}: "
                f"{response.text[:200]}"
            )

    body = response.json()
    result = body.get("result", body)  # envelope or raw
    return CheckResult(
        verdict=result.get("verdict", "pass"),
        violations=list(result.get("violations") or []),
        review_reason=result.get("review_reason"),
        content_type=result.get("content_type"),
        moment=result.get("moment"),
        rationale_chain=list(result.get("rationale_chain") or []),
    )
