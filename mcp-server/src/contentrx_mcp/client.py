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

_USER_AGENT = "contentrx-mcp/0.9.0"
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
class TeamRule:
    """A single team_rules row. Mirrors the Drizzle schema at
    `src/db/schema.ts` but keeps the substrate `team_owner_user_id`
    field internal — the caller IS the team, no need to surface it.
    """

    id: str
    standard_id: str
    action: str  # "disable" | "override" | "add"
    rule_json: dict[str, Any]
    created_at: str
    updated_at: str


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
        """POST /api/check — full evaluation. Counts against monthly quota.

        Schema 3.0.0 (2026-05-05) dropped the `segment_type`
        parameter. The /api/check endpoint now derives the size class
        from `text.length` server-side: 1 unit per 200 characters,
        rounded up, floor 1 unit. Inputs >200 chars get the rich
        long-form review (holistic rewrite + categorized findings
        + inline excerpts); shorter inputs get per-finding diff cards.
        """
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
        self._check_schema_major(data)
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
        self._check_schema_major(data)
        result = data.get("result", {})
        return ClassifyResult(
            content_type=result.get("content_type", "unknown"),
            moment=result.get("moment", "unknown"),
        )

    # Major version of the wire format this MCP server is built
    # against. A 4.x bump with breaking changes will fail loudly here
    # instead of silently parsing the new shape with old assumptions.
    _SUPPORTED_SCHEMA_MAJOR = 3

    def _check_schema_major(self, response: dict[str, Any]) -> None:
        sv = response.get("schema_version")
        if sv is None or not isinstance(sv, str) or "." not in sv:
            return
        try:
            major = int(sv.split(".", 1)[0])
        except ValueError:
            return
        if major != self._SUPPORTED_SCHEMA_MAJOR:
            raise ContentRXError(
                f"ContentRX returned schema_version={sv} but this MCP "
                f"server was built for major {self._SUPPORTED_SCHEMA_MAJOR}. "
                "Upgrade `contentrx-mcp` to a compatible release."
            )

    # ------------------------------------------------------------------
    # Team rules (CRUD on /api/team-rules)
    # ------------------------------------------------------------------

    async def add_team_rule(
        self,
        *,
        action: str,
        standard_id: str | None = None,
        rule_json: dict[str, Any] | None = None,
    ) -> TeamRule:
        """POST /api/team-rules — create a disable / override / add rule.

        action="disable": needs `standard_id` (a stock standard or a
            custom TEAM-NN id). `rule_json` is ignored.
        action="override": needs `standard_id` + `rule_json` carrying
            at least one of {rule, severity, title}.
        action="add": needs `rule_json` with {title, rule, pattern}
            and optionally {severity, case_insensitive, content_types}.
            `standard_id` is auto-generated as TEAM-NN server-side.
        """
        body: dict[str, Any] = {"action": action}
        if standard_id is not None:
            body["standard_id"] = standard_id
        if rule_json is not None:
            body["rule_json"] = rule_json
        resp = await self._client.post("/api/team-rules", json=body)
        self._raise_for_typed_status(resp)
        data = resp.json()
        rule = (data.get("result") or {}).get("rule") or {}
        return _team_rule_from_json(rule)

    async def list_team_rules(self) -> list[TeamRule]:
        """GET /api/team-rules — list the team's rules."""
        resp = await self._client.get("/api/team-rules")
        self._raise_for_typed_status(resp)
        result = (resp.json().get("result") or {})
        return [
            _team_rule_from_json(r) for r in (result.get("rules") or [])
        ]

    async def update_team_rule(
        self,
        *,
        rule_id: str,
        rule_json: dict[str, Any],
    ) -> TeamRule:
        """PATCH /api/team-rules/[id] — update an existing rule's body."""
        resp = await self._client.patch(
            f"/api/team-rules/{rule_id}",
            json={"rule_json": rule_json},
        )
        self._raise_for_typed_status(resp)
        data = resp.json()
        rule = (data.get("result") or {}).get("rule") or {}
        return _team_rule_from_json(rule)

    async def remove_team_rule(self, *, rule_id: str) -> bool:
        """DELETE /api/team-rules/[id]. Returns True on success."""
        resp = await self._client.delete(f"/api/team-rules/{rule_id}")
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


def _team_rule_from_json(entry: dict[str, Any]) -> TeamRule:
    """Convert the REST payload shape into the TeamRule dataclass.
    Drizzle returns camelCase from `.returning()`; the route wraps
    rows into `envelope({rule: row})` so the field names there are
    Drizzle-camel.
    """
    return TeamRule(
        id=entry.get("id", ""),
        standard_id=entry.get("standardId") or entry.get("standard_id") or "",
        action=entry.get("action", ""),
        rule_json=dict(entry.get("ruleJson") or entry.get("rule_json") or {}),
        created_at=str(entry.get("createdAt") or entry.get("created_at") or ""),
        updated_at=str(entry.get("updatedAt") or entry.get("updated_at") or ""),
    )
