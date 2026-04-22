"""Async HTTP client for the ContentRX API.

Thin wrapper over `httpx.AsyncClient` that:
- Adds the `Authorization: Bearer cx_<token>` header on every request
- Maps server-side errors to typed exceptions the MCP server can surface
- Treats 429 (rate limit) as a typed retryable error so the MCP client
  shows a "try again in N seconds" message instead of a stack trace
  (BUILD_PLAN_v2 Session 4 acceptance criterion)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .auth import get_api_base_url, get_api_key

_USER_AGENT = "contentrx-mcp/0.1.0"
_TIMEOUT_SECONDS = 60.0


class ContentRXError(Exception):
    """Generic API failure surfaced to the MCP client as a tool error."""


class AuthFailedError(ContentRXError):
    """The API rejected the cx_token (revoked, malformed, never minted)."""


class QuotaExhaustedError(ContentRXError):
    """The user's monthly quota is at zero. Includes upgrade URL on the message."""


class RateLimitError(ContentRXError):
    """Per-user rate limit hit. Carries seconds until reset for retry."""

    def __init__(self, message: str, retry_after_seconds: int):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


@dataclass
class CheckResult:
    """Subset of /api/check response surfaced to MCP clients."""

    overall_verdict: str
    content_type: str | None
    moment: str | None
    violations: list[dict[str, Any]]
    passes: list[dict[str, Any]]
    summary: str | None


@dataclass
class ClassifyResult:
    content_type: str
    moment: str


class ContentRXClient:
    """Holds an httpx.AsyncClient + the cx_token. Created once per tool call."""

    def __init__(self, *, api_key: str, base_url: str):
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=_TIMEOUT_SECONDS,
            headers={
                "User-Agent": _USER_AGENT,
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    async def __aenter__(self) -> "ContentRXClient":
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self._client.aclose()

    async def check(
        self,
        *,
        text: str,
        moment: str | None = None,
        content_type: str | None = None,
    ) -> CheckResult:
        """POST /api/check — full evaluation. Counts against monthly quota."""
        body: dict[str, Any] = {"text": text, "source": "plugin"}
        if moment:
            body["moment"] = moment
        if content_type:
            body["content_type"] = content_type
        # Note: source="plugin" rather than a new "mcp" enum value because
        # the engine's source enum is locked at the schema level. Once
        # the schema gets bumped (BUILD_PLAN_v2 Session 9 envelope) we can
        # add "mcp" without breaking existing log queries.

        resp = await self._client.post("/api/check", json=body)
        self._raise_for_typed_status(resp)
        data = resp.json()
        result = data.get("result", {})
        return CheckResult(
            overall_verdict=result.get("overall_verdict", "unknown"),
            content_type=result.get("content_type"),
            moment=result.get("moment"),
            violations=list(result.get("violations") or []),
            passes=list(result.get("passes") or []),
            summary=result.get("summary"),
        )

    async def classify(self, *, text: str) -> ClassifyResult:
        """POST /api/classify — content_type + moment only. Free of quota."""
        resp = await self._client.post("/api/classify", json={"text": text})
        self._raise_for_typed_status(resp)
        data = resp.json()
        result = data.get("result", {})
        return ClassifyResult(
            content_type=result.get("content_type", "unknown"),
            moment=result.get("moment", "unknown"),
        )

    @staticmethod
    def _raise_for_typed_status(resp: httpx.Response) -> None:
        if resp.is_success:
            return
        body: dict[str, Any]
        try:
            body = resp.json()
        except ValueError:
            body = {"error": resp.text or resp.reason_phrase}
        message = body.get("error") or "Request failed"

        if resp.status_code in (401, 403):
            raise AuthFailedError(
                f"{message}. Re-mint your API key at "
                f"https://content-rx.vercel.app/dashboard."
            )
        if resp.status_code == 402:
            quota = body.get("quota")
            used = body.get("used")
            upgrade = body.get("upgrade_url") or "https://content-rx.vercel.app/dashboard"
            raise QuotaExhaustedError(
                f"Monthly quota exhausted ({used}/{quota} used). "
                f"Upgrade at {upgrade}."
            )
        if resp.status_code == 429:
            retry_after_raw = resp.headers.get("retry-after", "60")
            try:
                retry_after = int(retry_after_raw)
            except ValueError:
                retry_after = 60
            raise RateLimitError(
                f"Rate limit hit. Try again in {retry_after}s.",
                retry_after_seconds=retry_after,
            )
        raise ContentRXError(f"{resp.status_code} {message}")


def open_client() -> ContentRXClient:
    """Construct a client from the environment. Caller manages lifecycle."""
    return ContentRXClient(api_key=get_api_key(), base_url=get_api_base_url())
