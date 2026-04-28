"""Tests for the custom_example_* MCP tools (human-eval Session 30 PR B).

Mocks `httpx.AsyncClient` the same way test_client.py does. Pins the
request / response shape so a mid-release regression on /api/team-
custom-examples shows up here before MCP clients hit it.
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
async def test_add_custom_example_posts_expected_body_and_parses_result():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            201,
            json={
                "schema_version": "1.6.0",
                "warnings": [],
                "result": {
                    "example": {
                        "id": "ce_abc123",
                        "text": "Let's go.",
                        "verdict": "pass",
                        "moment": "confirmation",
                        "contentType": None,
                        "standardId": None,
                        "notes": "Intentional voice.",
                        "contributeUpstream": False,
                        "createdAt": "2026-04-24T16:00:00.000Z",
                        "updatedAt": "2026-04-24T16:00:00.000Z",
                    },
                },
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        entry = await client.add_custom_example(
            text="Let's go.",
            verdict="pass",
            moment="confirmation",
            notes="Intentional voice.",
        )

    assert captured["method"] == "POST"
    assert captured["path"] == "/api/team-custom-examples"
    assert captured["body"]["text"] == "Let's go."
    assert captured["body"]["verdict"] == "pass"
    assert captured["body"]["moment"] == "confirmation"
    # content_type wasn't passed → not in body (explicit null avoidance).
    assert "content_type" not in captured["body"]
    assert entry.id == "ce_abc123"
    assert entry.contribute_upstream is False


@pytest.mark.asyncio
async def test_list_custom_examples_returns_cap_and_entries():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/team-custom-examples"
        return httpx.Response(
            200,
            json={
                "schema_version": "1.6.0",
                "warnings": [],
                "result": {
                    "examples": [
                        {
                            "id": "ce_1",
                            "text": "Let's go.",
                            "verdict": "pass",
                            "moment": "confirmation",
                            "contentType": None,
                            "standardId": None,
                            "notes": None,
                            "contributeUpstream": False,
                            "createdAt": "2026-04-24T16:00:00.000Z",
                            "updatedAt": "2026-04-24T16:00:00.000Z",
                        },
                        {
                            "id": "ce_2",
                            "text": "Contact administrator.",
                            "verdict": "violation",
                            "moment": None,
                            "contentType": "error_message",
                            "standardId": "VT-05",
                            "notes": "Blames the user.",
                            "contributeUpstream": True,
                            "createdAt": "2026-04-24T16:05:00.000Z",
                            "updatedAt": "2026-04-24T16:05:00.000Z",
                        },
                    ],
                    "count": 2,
                    "cap": 500,
                },
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.list_custom_examples()

    assert result.count == 2
    assert result.cap == 500
    assert result.examples[0].id == "ce_1"
    assert result.examples[1].verdict == "violation"
    assert result.examples[1].standard_id == "VT-05"
    assert result.examples[1].contribute_upstream is True


@pytest.mark.asyncio
async def test_search_custom_examples_passes_text_param():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["query"] = request.url.query.decode()
        return httpx.Response(
            200,
            json={
                "schema_version": "1.6.0",
                "warnings": [],
                "result": {"examples": [], "count": 0, "cap": 500},
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.search_custom_examples(text="Hello")

    assert "text=Hello" in captured["query"]
    assert result.count == 0
    assert result.examples == []


@pytest.mark.asyncio
async def test_remove_custom_example_issues_delete():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == "/api/team-custom-examples/ce_42"
        return httpx.Response(
            200,
            json={
                "schema_version": "1.6.0",
                "warnings": [],
                "result": {"ok": True, "deleted_id": "ce_42"},
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        assert await client.remove_custom_example(example_id="ce_42") is True


@pytest.mark.asyncio
async def test_delete_maps_404_to_contentrx_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Not found"})

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(ContentRXError):
            await client.remove_custom_example(example_id="missing")


@pytest.mark.asyncio
async def test_add_maps_409_uniqueness_collision_to_contentrx_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={"error": "A custom example for this text already exists."},
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(ContentRXError, match="already exists"):
            await client.add_custom_example(text="dup", verdict="pass")


@pytest.mark.asyncio
async def test_add_maps_403_plan_gating_to_auth_failed():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"error": "Custom examples are a Team-plan feature."},
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(AuthFailedError):
            await client.add_custom_example(text="x", verdict="pass")


@pytest.mark.asyncio
async def test_list_maps_429_to_rate_limit_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={"error": "Rate limit exceeded"},
            headers={"retry-after": "30"},
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(RateLimitError) as exc_info:
            await client.list_custom_examples()
    assert exc_info.value.retry_after_seconds == 30


@pytest.mark.asyncio
async def test_example_json_parser_accepts_snake_and_camel_case():
    """The admin REST endpoint returns camelCase (Drizzle defaults);
    the CLI + any future shim might emit snake_case. The parser must
    handle both so the contract is robust across surfaces.
    """
    from contentrx_mcp.client import _example_from_json

    camel = _example_from_json({
        "id": "ce_1",
        "text": "hi",
        "verdict": "pass",
        "moment": None,
        "contentType": "button_cta",
        "standardId": "VT-05",
        "notes": "note",
        "contributeUpstream": True,
        "createdAt": "2026-04-24T16:00:00Z",
        "updatedAt": "2026-04-24T16:00:00Z",
    })
    snake = _example_from_json({
        "id": "ce_1",
        "text": "hi",
        "verdict": "pass",
        "moment": None,
        "content_type": "button_cta",
        "standard_id": "VT-05",
        "notes": "note",
        "contribute_upstream": True,
        "created_at": "2026-04-24T16:00:00Z",
        "updated_at": "2026-04-24T16:00:00Z",
    })
    assert camel == snake
