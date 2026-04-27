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


@dataclass
class SuggestFixResult:
    rewritten: str
    standard_id: str | None = None


async def check(
    text: str,
    *,
    source: str = "lsp",
    content_type: str | None = None,
    moment: str | None = None,
) -> CheckResult:
    """POST /api/check for a single string.

    `source="lsp"` records violations under the lsp source bucket so
    team-analytics + override-rate reports can distinguish inline-
    editor overrides from plugin / CLI / CI overrides. Added as an
    enum value on `violations.source` + `violation_overrides.source`
    in the same PR as this change.
    """
    api_key = get_api_key()
    base_url = get_api_base_url()

    payload: dict[str, Any] = {"text": text, "source": source}
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


async def suggest_fix(
    *,
    text: str,
    standard_id: str | None = None,
    rule: str | None = None,
    issue: str | None = None,
    current_suggestion: str | None = None,
) -> SuggestFixResult:
    """POST /api/suggest-fix for a targeted rewrite.

    Consumed by the LSP code-action provider when the user invokes
    the "Replace with suggested rewrite" action. One quota slot per
    call — treat it as an LLM call because that's exactly what it is.

    `standard_id` is optional per ADR 2026-04-25 — schema 2.0.0 LSP
    diagnostics don't carry substrate, so the rewriter falls back to
    `issue` + `current_suggestion`. Caller must supply at least one of
    those three or the API returns 400.
    """
    api_key = get_api_key()
    base_url = get_api_base_url()

    payload: dict[str, Any] = {"text": text}
    if standard_id:
        payload["standard_id"] = standard_id
    if rule:
        payload["rule"] = rule
    if issue:
        payload["issue"] = issue
    if current_suggestion:
        payload["current_suggestion"] = current_suggestion

    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": _USER_AGENT,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        try:
            response = await client.post(
                f"{base_url}/api/suggest-fix",
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
    result = body.get("result", body)
    return SuggestFixResult(
        rewritten=result.get("rewritten", "") or "",
        standard_id=result.get("standard_id") or standard_id,
    )


async def mark_false_positive(
    *,
    text: str,
    standard_id: str,
) -> None:
    """POST /api/violations/override with override_type=mark_false_positive.

    Fire-and-forget from the LSP's perspective — the editor already
    removed the diagnostic optimistically when the user invoked the
    action. Errors still bubble up so the server layer can surface
    them via `window/showMessage`.
    """
    api_key = get_api_key()
    base_url = get_api_base_url()

    payload: dict[str, Any] = {
        "text": text,
        "standard_id": standard_id,
        "override_type": "mark_false_positive",
        "source": "lsp",
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": _USER_AGENT,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        try:
            response = await client.post(
                f"{base_url}/api/violations/override",
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
        if response.status_code >= 400:
            raise ContentRXError(
                f"ContentRX API error {response.status_code}: "
                f"{response.text[:200]}"
            )
