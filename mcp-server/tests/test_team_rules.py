"""Tests for the team_rule_* MCP tools.

Mirrors test_custom_examples.py — mocks `httpx.AsyncClient` and pins
the request / response shape so a regression on /api/team-rules
shows up here before MCP clients hit it.
"""

from __future__ import annotations

import json

import httpx
import pytest

from contentrx_mcp.client import (
    AuthFailedError,
    ContentRXClient,
    ContentRXError,
    RateLimitError,
)


def _client_with(transport: httpx.MockTransport) -> ContentRXClient:
    obj = ContentRXClient.__new__(ContentRXClient)
    obj._api_key = "cx_test_key_xxxxxxxxx"  # type: ignore[attr-defined]
    obj._client = httpx.AsyncClient(  # type: ignore[attr-defined]
        base_url="https://test.contentrx",
        transport=transport,
        headers={
            "Authorization": "Bearer cx_test_key_xxxxxxxxx",
            "Content-Type": "application/json",
        },
    )
    return obj


@pytest.mark.asyncio
async def test_add_team_rule_disable_posts_action_and_standard_id():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            201,
            json={
                "schema_version": "3.0.0",
                "warnings": [],
                "result": {
                    "rule": {
                        "id": "tr_abc123",
                        "standardId": "GRM-01",
                        "action": "disable",
                        "ruleJson": {},
                        "createdAt": "2026-05-05T16:00:00.000Z",
                        "updatedAt": "2026-05-05T16:00:00.000Z",
                    },
                },
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        rule = await client.add_team_rule(
            action="disable",
            standard_id="GRM-01",
        )

    assert captured["method"] == "POST"
    assert captured["path"] == "/api/team-rules"
    assert captured["body"]["action"] == "disable"
    assert captured["body"]["standard_id"] == "GRM-01"
    # rule_json wasn't passed → not in body.
    assert "rule_json" not in captured["body"]
    assert rule.id == "tr_abc123"
    assert rule.action == "disable"
    assert rule.rule_json == {}


@pytest.mark.asyncio
async def test_add_team_rule_override_includes_rule_json():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            201,
            json={
                "schema_version": "3.0.0",
                "warnings": [],
                "result": {
                    "rule": {
                        "id": "tr_override_1",
                        "standardId": "GRM-01",
                        "action": "override",
                        "ruleJson": {"severity": "high"},
                        "createdAt": "2026-05-05T16:00:00.000Z",
                        "updatedAt": "2026-05-05T16:00:00.000Z",
                    },
                },
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        rule = await client.add_team_rule(
            action="override",
            standard_id="GRM-01",
            rule_json={"severity": "high"},
        )

    assert captured["body"]["action"] == "override"
    assert captured["body"]["standard_id"] == "GRM-01"
    assert captured["body"]["rule_json"] == {"severity": "high"}
    assert rule.rule_json == {"severity": "high"}


@pytest.mark.asyncio
async def test_add_team_rule_add_action_omits_standard_id():
    """For action="add" the server auto-generates the TEAM-NN id;
    the client should not require standard_id from the caller."""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            201,
            json={
                "schema_version": "3.0.0",
                "warnings": [],
                "result": {
                    "rule": {
                        "id": "tr_new_1",
                        "standardId": "TEAM-01",
                        "action": "add",
                        "ruleJson": {
                            "title": "No exclamation in errors",
                            "rule": "Errors should be calm, not excited.",
                            "pattern": "!",
                            "severity": "medium",
                        },
                        "createdAt": "2026-05-05T16:00:00.000Z",
                        "updatedAt": "2026-05-05T16:00:00.000Z",
                    },
                },
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        rule = await client.add_team_rule(
            action="add",
            rule_json={
                "title": "No exclamation in errors",
                "rule": "Errors should be calm, not excited.",
                "pattern": "!",
                "severity": "medium",
            },
        )

    assert captured["body"]["action"] == "add"
    assert "standard_id" not in captured["body"]
    assert captured["body"]["rule_json"]["pattern"] == "!"
    assert rule.standard_id == "TEAM-01"


@pytest.mark.asyncio
async def test_list_team_rules_returns_parsed_rows():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/team-rules"
        return httpx.Response(
            200,
            json={
                "schema_version": "3.0.0",
                "warnings": [],
                "result": {
                    "rules": [
                        {
                            "id": "tr_1",
                            "standardId": "GRM-01",
                            "action": "disable",
                            "ruleJson": {},
                            "createdAt": "2026-05-05T16:00:00.000Z",
                            "updatedAt": "2026-05-05T16:00:00.000Z",
                        },
                        {
                            "id": "tr_2",
                            "standardId": "TEAM-01",
                            "action": "add",
                            "ruleJson": {
                                "title": "No exclamation",
                                "rule": "Calm voice.",
                                "pattern": "!",
                                "severity": "medium",
                            },
                            "createdAt": "2026-05-05T16:05:00.000Z",
                            "updatedAt": "2026-05-05T16:05:00.000Z",
                        },
                    ],
                    "is_admin": True,
                },
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        rules = await client.list_team_rules()

    assert len(rules) == 2
    assert rules[0].id == "tr_1"
    assert rules[0].action == "disable"
    assert rules[1].standard_id == "TEAM-01"
    assert rules[1].rule_json["pattern"] == "!"


@pytest.mark.asyncio
async def test_update_team_rule_patches_with_rule_json_only():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={
                "schema_version": "3.0.0",
                "warnings": [],
                "result": {
                    "rule": {
                        "id": "tr_2",
                        "standardId": "TEAM-01",
                        "action": "add",
                        "ruleJson": {
                            "title": "No exclamation",
                            "rule": "Calm voice.",
                            "pattern": "!{1,}",
                            "severity": "high",
                        },
                        "createdAt": "2026-05-05T16:00:00.000Z",
                        "updatedAt": "2026-05-05T16:10:00.000Z",
                    },
                },
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        rule = await client.update_team_rule(
            rule_id="tr_2",
            rule_json={
                "title": "No exclamation",
                "rule": "Calm voice.",
                "pattern": "!{1,}",
                "severity": "high",
            },
        )

    assert captured["method"] == "PATCH"
    assert captured["path"] == "/api/team-rules/tr_2"
    # PATCH only carries rule_json; nothing else.
    assert set(captured["body"].keys()) == {"rule_json"}
    assert rule.rule_json["pattern"] == "!{1,}"
    assert rule.rule_json["severity"] == "high"


@pytest.mark.asyncio
async def test_remove_team_rule_issues_delete():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == "/api/team-rules/tr_42"
        return httpx.Response(
            200,
            json={
                "schema_version": "3.0.0",
                "warnings": [],
                "result": {"ok": True},
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        assert await client.remove_team_rule(rule_id="tr_42") is True


@pytest.mark.asyncio
async def test_remove_team_rule_404_maps_to_contentrx_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Not found"})

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(ContentRXError):
            await client.remove_team_rule(rule_id="missing")


@pytest.mark.asyncio
async def test_add_team_rule_402_plan_gating_maps_to_contentrx_error():
    """A non-Team-plan caller writing rules gets 402; the typed-status
    helper maps that to a generic ContentRXError, not AuthFailedError
    (402 is a billing signal, not auth)."""
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402,
            json={
                "error": "Editing team rules is available on the Team plan.",
                "quota": 0,
                "used": 0,
                "upgrade_url": "https://contentrx.io/dashboard",
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        # 402 raises QuotaExhaustedError per the client's typed-status
        # helper (the same helper /api/check uses for quota gating).
        from contentrx_mcp.client import QuotaExhaustedError
        with pytest.raises(QuotaExhaustedError):
            await client.add_team_rule(
                action="disable",
                standard_id="GRM-01",
            )


@pytest.mark.asyncio
async def test_add_team_rule_403_member_write_maps_to_auth_failed():
    """Team members (non-owners) get 403 from POST. That's an auth
    boundary — they're authenticated but not authorized."""
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"error": "Only the team owner can edit rules"},
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(AuthFailedError):
            await client.add_team_rule(
                action="disable",
                standard_id="GRM-01",
            )


@pytest.mark.asyncio
async def test_list_team_rules_429_maps_to_rate_limit_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={"error": "Rate limit exceeded"},
            headers={"retry-after": "60"},
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(RateLimitError) as exc_info:
            await client.list_team_rules()
    assert exc_info.value.retry_after_seconds == 60


@pytest.mark.asyncio
async def test_team_rule_json_parser_accepts_snake_and_camel_case():
    """Drizzle returns camelCase from `.returning()`; tests + alternate
    callers might emit snake_case. Parser must handle both."""
    from contentrx_mcp.client import _team_rule_from_json

    camel = _team_rule_from_json({
        "id": "tr_1",
        "standardId": "GRM-01",
        "action": "disable",
        "ruleJson": {"foo": "bar"},
        "createdAt": "2026-05-05T16:00:00Z",
        "updatedAt": "2026-05-05T16:00:00Z",
    })
    snake = _team_rule_from_json({
        "id": "tr_1",
        "standard_id": "GRM-01",
        "action": "disable",
        "rule_json": {"foo": "bar"},
        "created_at": "2026-05-05T16:00:00Z",
        "updated_at": "2026-05-05T16:00:00Z",
    })
    assert camel == snake
    assert camel.rule_json == {"foo": "bar"}
