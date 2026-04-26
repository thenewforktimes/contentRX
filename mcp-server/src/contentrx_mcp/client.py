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

_USER_AGENT = "contentrx-mcp/0.5.0"
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
        self._require_auth()
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
        self._require_auth()
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
        self._require_auth()
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
        self._require_auth()
        resp = await self._client.delete(
            f"/api/team-custom-examples/{example_id}",
        )
        self._raise_for_typed_status(resp)
        return True

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
