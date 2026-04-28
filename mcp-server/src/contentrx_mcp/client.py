"""Async HTTP client for the ContentRX API.

Thin wrapper over `httpx.AsyncClient` that:
- Adds the `Authorization: Bearer cx_<token>` header on every request
- Maps server-side errors to typed exceptions the MCP server can surface
- Treats 429 (rate limit) as a typed retryable error so the MCP client
  shows a "try again in N seconds" message instead of a stack trace
  (BUILD_PLAN_v2 Session 4 acceptance criterion)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from .auth import get_api_base_url, get_api_key

_USER_AGENT = "contentrx-mcp/0.6.0"
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
    """Subset of /api/check response surfaced to MCP clients.

    Schema 2.0.0 (ADR 2026-04-25). Substrate fields (`standard_id`,
    `rule`, `rule_version`, `related_standards`, `rationale_chain`,
    `moment`, `passes`, `content_type`, `summary`) are stripped at the
    /api/check boundary and never reach this client.
    """

    verdict: str  # "pass" | "violation" | "review_recommended" | "error"
    review_reason: str | None
    violations: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


@dataclass
class ClassifyResult:
    content_type: str
    moment: str


@dataclass
class CustomExample:
    """A single team-scoped custom-example entry (human-eval Session 30)."""

    id: str
    text: str
    verdict: str  # "pass" | "violation"
    moment: str | None
    content_type: str | None
    standard_id: str | None
    notes: str | None
    contribute_upstream: bool
    created_at: str
    updated_at: str


@dataclass
class CustomExampleCap:
    """Pagination-like response envelope for list + search."""

    examples: list[CustomExample]
    count: int
    cap: int


class ContentRXClient:
    """Holds an httpx.AsyncClient + a cx_token. Created per tool call."""

    def __init__(self, *, api_key: str, base_url: str):
        self._api_key = api_key
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=_TIMEOUT_SECONDS,
            headers={
                "User-Agent": _USER_AGENT,
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
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
        body: dict[str, Any] = {"text": text, "source": "mcp"}
        if moment:
            body["moment"] = moment
        if content_type:
            body["content_type"] = content_type
        # Closes audit M-26. Was source="plugin" because the engine's
        # source enum was locked; we widened it across /api/check,
        # /api/violations/override, log-violations.ts, and actor-role.ts
        # to add "mcp" so MCP-originating activity is correctly
        # attributed in analytics rollups instead of inflating the
        # plugin numbers.

        resp = await self._client.post("/api/check", json=body)
        self._raise_for_typed_status(resp)
        data = resp.json()
        # Schema 2.0.0 — top-level shape. No `result` wrapper; violations,
        # verdict, review_reason, warnings live alongside schema_version
        # at the top of the response. See `src/lib/api-envelope.ts`.
        return CheckResult(
            verdict=data.get("verdict", "pass"),
            review_reason=data.get("review_reason"),
            violations=list(data.get("violations") or []),
            warnings=list(data.get("warnings") or []),
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

    # ------------------------------------------------------------------
    # Custom examples (human-eval build plan Session 30, PR B)
    # ------------------------------------------------------------------

    async def add_custom_example(
        self,
        *,
        text: str,
        verdict: str,
        moment: str | None = None,
        content_type: str | None = None,
        standard_id: str | None = None,
        notes: str | None = None,
        contribute_upstream: bool = False,
    ) -> CustomExample:
        """POST /api/team-custom-examples — add one entry. Admin-only."""
        body: dict[str, Any] = {
            "text": text,
            "verdict": verdict,
            "contribute_upstream": contribute_upstream,
        }
        if moment is not None:
            body["moment"] = moment
        if content_type is not None:
            body["content_type"] = content_type
        if standard_id is not None:
            body["standard_id"] = standard_id
        if notes is not None:
            body["notes"] = notes
        resp = await self._client.post("/api/team-custom-examples", json=body)
        self._raise_for_typed_status(resp)
        data = resp.json()
        entry = (data.get("result") or {}).get("example") or {}
        return _example_from_json(entry)

    async def list_custom_examples(
        self,
        *,
        limit: int | None = None,
    ) -> CustomExampleCap:
        """GET /api/team-custom-examples — list the team's entries."""
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = str(limit)
        resp = await self._client.get(
            "/api/team-custom-examples",
            params=params or None,
        )
        self._raise_for_typed_status(resp)
        result = (resp.json().get("result") or {})
        return CustomExampleCap(
            examples=[_example_from_json(e) for e in (result.get("examples") or [])],
            count=int(result.get("count") or 0),
            cap=int(result.get("cap") or 0),
        )

    async def search_custom_examples(self, *, text: str) -> CustomExampleCap:
        """GET /api/team-custom-examples?text=… — check if a string is covered."""
        resp = await self._client.get(
            "/api/team-custom-examples",
            params={"text": text},
        )
        self._raise_for_typed_status(resp)
        result = (resp.json().get("result") or {})
        return CustomExampleCap(
            examples=[_example_from_json(e) for e in (result.get("examples") or [])],
            count=int(result.get("count") or 0),
            cap=int(result.get("cap") or 0),
        )

    async def remove_custom_example(self, *, example_id: str) -> bool:
        """DELETE /api/team-custom-examples/[id]. Returns True on success."""
        resp = await self._client.delete(
            f"/api/team-custom-examples/{example_id}",
        )
        self._raise_for_typed_status(resp)
        return True

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
                f"https://contentrx.io/dashboard."
            )
        if resp.status_code == 402:
            quota = body.get("quota")
            used = body.get("used")
            upgrade = body.get("upgrade_url") or "https://contentrx.io/dashboard"
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
    """Construct an authenticated client from env. Raises if API key missing."""
    return ContentRXClient(api_key=get_api_key(), base_url=get_api_base_url())


# ---------------------------------------------------------------------------
# Response parsers
# ---------------------------------------------------------------------------


def _example_from_json(entry: dict[str, Any]) -> CustomExample:
    """Convert the REST payload shape (camel + snake mix) into the
    dataclass. Keeps the rest of the client free of shape-wrangling.
    """
    return CustomExample(
        id=entry.get("id", ""),
        text=entry.get("text", ""),
        verdict=entry.get("verdict", ""),
        moment=entry.get("moment"),
        content_type=entry.get("contentType") or entry.get("content_type"),
        standard_id=entry.get("standardId") or entry.get("standard_id"),
        notes=entry.get("notes"),
        contribute_upstream=bool(
            entry.get("contributeUpstream") or entry.get("contribute_upstream") or False
        ),
        created_at=str(entry.get("createdAt") or entry.get("created_at") or ""),
        updated_at=str(entry.get("updatedAt") or entry.get("updated_at") or ""),
    )
