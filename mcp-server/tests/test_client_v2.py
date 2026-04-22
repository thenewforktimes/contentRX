"""Tests for the v0.2 client surface (catalog endpoints + optional auth).

Mocks httpx.AsyncClient so no network is required. Covers the typed
mappings for the new public endpoints (/api/standards, /api/standards/[id],
/api/moments) plus the optional-auth client and the
list_standards moment-filter logic.
"""

from __future__ import annotations

import httpx
import pytest

from contentrx_mcp.auth import AuthError
from contentrx_mcp.client import (
    ContentRXClient,
    open_optional_client,
)


def _client_with(transport: httpx.MockTransport, *, api_key: str | None = "cx_test_key_xxxxxxx") -> ContentRXClient:
    """Build a ContentRXClient backed by a mock transport for tests."""
    obj = ContentRXClient.__new__(ContentRXClient)
    obj._api_key = api_key  # type: ignore[attr-defined]
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    obj._client = httpx.AsyncClient(  # type: ignore[attr-defined]
        base_url="https://test.contentrx",
        transport=transport,
        headers=headers,
    )
    return obj


@pytest.mark.asyncio
async def test_list_standards_no_filter():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/standards"
        return httpx.Response(
            200,
            json={
                "version": "4.6.1",
                "categories": [
                    {
                        "id": "clarity",
                        "name": "Clarity",
                        "standards": [
                            {"id": "CLR-01", "rule": "Use plain language.", "rule_type": "nuanced"},
                            {"id": "CLR-02", "rule": "Lead with the most important info.", "rule_type": "nuanced"},
                        ],
                    },
                    {
                        "id": "grammar",
                        "name": "Grammar",
                        "standards": [
                            {"id": "GRM-06", "rule": "Hyphenate compound modifiers.", "rule_type": "hard"},
                        ],
                    },
                ],
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.list_standards()
    assert len(result) == 3
    assert {s.id for s in result} == {"CLR-01", "CLR-02", "GRM-06"}


@pytest.mark.asyncio
async def test_list_standards_filtered_by_moment():
    standards_response = {
        "version": "4.6.1",
        "categories": [
            {
                "id": "clarity",
                "name": "Clarity",
                "standards": [
                    {"id": "CLR-01", "rule": "Use plain language.", "rule_type": "nuanced"},
                    {"id": "CLR-03", "rule": "Use short sentences.", "rule_type": "hard"},
                ],
            },
            {
                "id": "voice",
                "name": "Voice",
                "standards": [
                    {"id": "VT-05", "rule": "Show empathy in errors.", "rule_type": "nuanced"},
                ],
            },
        ],
    }
    moments_response = {
        "moments": [
            {
                "id": "error_recovery",
                "description": "Validation, system errors, failed states.",
                "weighted_standards": [
                    {"standard_id": "VT-05", "modifier": "emphasize", "rationale": "Empathy."},
                    {"standard_id": "CLR-01", "modifier": "relax", "rationale": "Already clear."},
                    {"standard_id": "GRM-06", "modifier": "suppress", "rationale": "Less critical here."},
                ],
            },
            {"id": "browsing_discovery", "description": "Homepages.", "weighted_standards": []},
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/standards":
            return httpx.Response(200, json=standards_response)
        if request.url.path == "/api/moments":
            return httpx.Response(200, json=moments_response)
        return httpx.Response(404, json={"error": "unexpected route"})

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.list_standards(moment="error_recovery")
    # Only emphasize/relax standards survive — suppress (GRM-06 here) is dropped,
    # and only standards present in the catalog are returned (so GRM-06 wouldn't
    # have appeared anyway, but VT-05 + CLR-01 should).
    ids = {s.id for s in result}
    assert ids == {"VT-05", "CLR-01"}


@pytest.mark.asyncio
async def test_get_standard_returns_full_detail():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/standards/CLR-01"
        return httpx.Response(
            200,
            json={
                "standard": {
                    "id": "CLR-01",
                    "rule": "Use plain language.",
                    "correct": "We couldn't sign you in.",
                    "incorrect": "Authentication parameters insufficient.",
                    "rule_type": "nuanced",
                    "relevant_content_types": ["error_message"],
                    "content_type_notes": {"_global": "Domain-mainstream OK."},
                },
                "category": {"id": "clarity", "name": "Clarity"},
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        std = await client.get_standard(standard_id="CLR-01")
    assert std.id == "CLR-01"
    assert std.category_name == "Clarity"
    assert std.relevant_content_types == ["error_message"]
    assert std.content_type_notes == {"_global": "Domain-mainstream OK."}


@pytest.mark.asyncio
async def test_get_standard_404():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Not found"})

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(Exception):
            await client.get_standard(standard_id="DOES-NOT-EXIST")


@pytest.mark.asyncio
async def test_list_moments_returns_full_taxonomy():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/moments"
        return httpx.Response(
            200,
            json={
                "moments": [
                    {
                        "id": "error_recovery",
                        "description": "Validation + errors.",
                        "weighted_standards": [
                            {"standard_id": "VT-05", "modifier": "emphasize", "rationale": "Empathy."}
                        ],
                    }
                ]
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        moments = await client.list_moments()
    assert len(moments) == 1
    assert moments[0].id == "error_recovery"
    assert moments[0].weighted_standards[0].standard_id == "VT-05"
    assert moments[0].weighted_standards[0].modifier == "emphasize"


@pytest.mark.asyncio
async def test_check_requires_auth_when_key_missing():
    """Public endpoints work without a key, but check() raises immediately."""
    client = _client_with(httpx.MockTransport(lambda _r: httpx.Response(200)), api_key=None)
    async with client:
        with pytest.raises(AuthError):
            await client.check(text="anything")


@pytest.mark.asyncio
async def test_classify_requires_auth_when_key_missing():
    client = _client_with(httpx.MockTransport(lambda _r: httpx.Response(200)), api_key=None)
    async with client:
        with pytest.raises(AuthError):
            await client.classify(text="anything")


@pytest.mark.asyncio
async def test_public_endpoints_work_without_key():
    """list_standards / list_moments / get_standard work without auth."""
    def handler(request: httpx.Request) -> httpx.Response:
        # Verify no Authorization header is sent on public calls
        assert "authorization" not in {k.lower() for k in request.headers}
        if request.url.path == "/api/standards":
            return httpx.Response(200, json={"categories": []})
        if request.url.path == "/api/moments":
            return httpx.Response(200, json={"moments": []})
        if request.url.path.startswith("/api/standards/"):
            return httpx.Response(404, json={"error": "Not found"})
        return httpx.Response(500)

    client = _client_with(httpx.MockTransport(handler), api_key=None)
    async with client:
        standards = await client.list_standards()
        moments = await client.list_moments()
    assert standards == []
    assert moments == []


def test_open_optional_client_works_without_key(monkeypatch):
    monkeypatch.delenv("CONTENTRX_API_KEY", raising=False)
    client = open_optional_client()
    assert client._api_key is None  # type: ignore[attr-defined]


def test_open_optional_client_picks_up_key_when_set(monkeypatch):
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_abcdefghijklmnop")
    client = open_optional_client()
    assert client._api_key == "cx_abcdefghijklmnop"  # type: ignore[attr-defined]
