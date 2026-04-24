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

from .auth import AuthError, get_api_base_url, get_api_key

_USER_AGENT = "contentrx-mcp/0.4.0"
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

    overall_verdict: str  # legacy: "pass" | "fail" | "error"
    content_type: str | None
    moment: str | None
    violations: list[dict[str, Any]]
    passes: list[dict[str, Any]]
    summary: str | None
    # v1.1.0 (BUILD_PLAN_v2 Session 10) — three-state verdict + reason.
    verdict: str = "pass"  # "pass" | "violation" | "review_recommended" | "error"
    review_reason: str | None = None
    # v1.2.0 (human-eval build plan Session 1) — rationale chain hops.
    # Passed through as opaque dicts so future additions to RationaleHop
    # flow to MCP clients without requiring a client bump.
    rationale_chain: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ClassifyResult:
    content_type: str
    moment: str


@dataclass
class StandardSummary:
    id: str
    rule: str
    correct: str | None = None
    incorrect: str | None = None
    rule_type: str | None = None
    relevant_content_types: list[str] | None = None


@dataclass
class StandardDetail:
    id: str
    rule: str
    correct: str | None
    incorrect: str | None
    rule_type: str | None
    relevant_content_types: list[str]
    content_type_notes: dict[str, str]
    category_id: str
    category_name: str


@dataclass
class WeightedStandard:
    standard_id: str
    modifier: str  # "emphasize" | "relax" | "suppress"
    rationale: str


@dataclass
class MomentEntry:
    id: str
    description: str
    weighted_standards: list[WeightedStandard]


class ContentRXClient:
    """Holds an httpx.AsyncClient + an optional cx_token. Created per tool call.

    Authenticated calls (check, classify) require the api_key to be set
    — if it isn't, those methods raise AuthError before hitting the
    network. Public calls (standards, moments) work either way.
    """

    def __init__(self, *, api_key: str | None, base_url: str):
        self._api_key = api_key
        headers: dict[str, str] = {
            "User-Agent": _USER_AGENT,
            "Content-Type": "application/json",
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=_TIMEOUT_SECONDS,
            headers=headers,
        )

    async def __aenter__(self) -> "ContentRXClient":
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self._client.aclose()

    def _require_auth(self) -> None:
        if not self._api_key:
            raise AuthError(
                "This call requires CONTENTRX_API_KEY. Generate one at "
                "https://contentrx.io/dashboard."
            )

    async def check(
        self,
        *,
        text: str,
        moment: str | None = None,
        content_type: str | None = None,
    ) -> CheckResult:
        """POST /api/check — full evaluation. Counts against monthly quota."""
        self._require_auth()
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
            verdict=result.get("verdict", result.get("overall_verdict", "pass")),
            review_reason=result.get("review_reason"),
            rationale_chain=list(result.get("rationale_chain") or []),
        )

    async def classify(self, *, text: str) -> ClassifyResult:
        """POST /api/classify — content_type + moment only. Free of quota."""
        self._require_auth()
        resp = await self._client.post("/api/classify", json={"text": text})
        self._raise_for_typed_status(resp)
        data = resp.json()
        result = data.get("result", {})
        return ClassifyResult(
            content_type=result.get("content_type", "unknown"),
            moment=result.get("moment", "unknown"),
        )

    async def list_standards(
        self, *, moment: str | None = None,
    ) -> list[StandardSummary]:
        """GET /api/standards — public catalog. Optional moment filter.

        When `moment` is provided, intersects the catalog with the
        moment's weighted-standards list (excluding suppressed
        standards) so the result is "rules this moment cares about."
        """
        resp = await self._client.get("/api/standards")
        self._raise_for_typed_status(resp)
        library = resp.json()
        all_standards: list[StandardSummary] = []
        for cat in library.get("categories") or []:
            for std in cat.get("standards") or []:
                all_standards.append(
                    StandardSummary(
                        id=std.get("id", ""),
                        rule=std.get("rule", ""),
                        correct=std.get("correct"),
                        incorrect=std.get("incorrect"),
                        rule_type=std.get("rule_type"),
                        relevant_content_types=std.get("relevant_content_types"),
                    )
                )
        if not moment:
            return all_standards
        relevant_ids = await self._standards_for_moment(moment)
        return [s for s in all_standards if s.id in relevant_ids]

    async def get_standard(self, *, standard_id: str) -> StandardDetail:
        """GET /api/standards/[id] — single standard with category metadata."""
        resp = await self._client.get(f"/api/standards/{standard_id}")
        self._raise_for_typed_status(resp)
        data = resp.json()
        std = data.get("standard") or {}
        cat = data.get("category") or {}
        return StandardDetail(
            id=std.get("id", standard_id),
            rule=std.get("rule", ""),
            correct=std.get("correct"),
            incorrect=std.get("incorrect"),
            rule_type=std.get("rule_type"),
            relevant_content_types=list(std.get("relevant_content_types") or []),
            content_type_notes=dict(std.get("content_type_notes") or {}),
            category_id=cat.get("id", ""),
            category_name=cat.get("name", ""),
        )

    async def list_moments(self) -> list[MomentEntry]:
        """GET /api/moments — full moments taxonomy + per-moment weights."""
        resp = await self._client.get("/api/moments")
        self._raise_for_typed_status(resp)
        data = resp.json()
        return [
            MomentEntry(
                id=m.get("id", ""),
                description=m.get("description", ""),
                weighted_standards=[
                    WeightedStandard(
                        standard_id=w.get("standard_id", ""),
                        modifier=w.get("modifier", ""),
                        rationale=w.get("rationale", ""),
                    )
                    for w in (m.get("weighted_standards") or [])
                ],
            )
            for m in (data.get("moments") or [])
        ]

    async def _standards_for_moment(self, moment: str) -> set[str]:
        """Standards that 'matter' for a moment — emphasize/relax, not suppress.

        A 'suppress' modifier means the standard rarely applies in this
        moment, so we exclude it from the filtered list. The result is
        the set of standard IDs a developer scoping copy for this moment
        should pay attention to.
        """
        moments = await self.list_moments()
        for m in moments:
            if m.id != moment:
                continue
            return {
                w.standard_id
                for w in m.weighted_standards
                if w.modifier in ("emphasize", "relax")
            }
        return set()

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


def open_optional_client() -> ContentRXClient:
    """Construct a client that includes auth IF set, but doesn't error if missing.

    Used by tools that hit only public endpoints (standards, moments) so
    a developer browsing the spec doesn't need a key. Authenticated
    methods on the returned client still raise AuthError if called
    without the key — auth gating happens per-method, not per-client.
    """
    base_url = get_api_base_url()
    try:
        api_key: str | None = get_api_key()
    except AuthError:
        api_key = None
    return ContentRXClient(api_key=api_key, base_url=base_url)
