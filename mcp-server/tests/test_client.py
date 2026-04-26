"""Tests for the typed HTTP client wrapper.

Mocks `httpx.AsyncClient` so no network access is required. Covers the
typed-error mapping that turns HTTP statuses into structured exceptions
the MCP server can render inline.
"""

from __future__ import annotations

import json

import httpx
import pytest

from contentrx_mcp.client import (
    AuthFailedError,
    ContentRXClient,
    ContentRXError,
    QuotaExhaustedError,
    RateLimitError,
)


def _client_with(transport: httpx.MockTransport) -> ContentRXClient:
    """Build a ContentRXClient backed by a mock transport for tests."""
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
async def test_check_success():
    """Schema 2.0.0 — top-level shape, public Violation fields only."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/check"
        body = json.loads(request.content.decode())
        assert body["text"] == "Click here"
        return httpx.Response(
            200,
            json={
                "schema_version": "2.0.0",
                "verdict": "violation",
                "review_reason": None,
                "violations": [
                    {
                        "issue": "Link text is too vague.",
                        "suggestion": "Replace with the destination.",
                        "severity": "high",
                        "confidence": 0.9,
                    }
                ],
                "warnings": [],
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.check(text="Click here")
    assert result.verdict == "violation"
    assert result.review_reason is None
    assert len(result.violations) == 1
    assert result.violations[0]["issue"] == "Link text is too vague."
    assert result.violations[0]["severity"] == "high"
    # Substrate fields must NEVER leak through the MCP boundary.
    assert "standard_id" not in result.violations[0]
    assert "rule_version" not in result.violations[0]


@pytest.mark.asyncio
async def test_check_review_recommended_passes_review_reason():
    """The typed `review_reason` subtype flows through the public
    envelope so MCP clients can route low-confidence cases differently
    from confirmed violations."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "schema_version": "2.0.0",
                "verdict": "review_recommended",
                "review_reason": "situation_ambiguity",
                "violations": [],
                "warnings": [],
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.check(text="Proceed?")
    assert result.verdict == "review_recommended"
    assert result.review_reason == "situation_ambiguity"


@pytest.mark.asyncio
async def test_check_pass_verdict():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "schema_version": "2.0.0",
                "verdict": "pass",
                "review_reason": None,
                "violations": [],
                "warnings": [],
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.check(text="OK")
    assert result.verdict == "pass"
    assert result.violations == []
    assert result.warnings == []


@pytest.mark.asyncio
async def test_classify_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/classify"
        return httpx.Response(
            200,
            json={
                "result": {"content_type": "error_message", "moment": "error_recovery"}
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.classify(text="Something went wrong.")
    assert result.content_type == "error_message"
    assert result.moment == "error_recovery"


@pytest.mark.asyncio
async def test_401_maps_to_auth_failed():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Invalid API key"})

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(AuthFailedError, match="Re-mint"):
            await client.check(text="x")


@pytest.mark.asyncio
async def test_402_maps_to_quota_exhausted():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402,
            json={
                "error": "Monthly quota exhausted",
                "quota": 25,
                "used": 25,
                "upgrade_url": "https://test/upgrade",
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(QuotaExhaustedError, match="25/25"):
            await client.check(text="x")


@pytest.mark.asyncio
async def test_429_maps_to_rate_limit_with_retry_after():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            headers={"retry-after": "30"},
            json={"error": "Rate limit exceeded"},
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(RateLimitError) as excinfo:
            await client.classify(text="x")
    assert excinfo.value.retry_after_seconds == 30


@pytest.mark.asyncio
async def test_429_default_retry_after_when_header_missing():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "Rate limit exceeded"})

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(RateLimitError) as excinfo:
            await client.classify(text="x")
    assert excinfo.value.retry_after_seconds == 60


@pytest.mark.asyncio
async def test_500_maps_to_generic_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "Evaluation service unavailable"})

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(ContentRXError, match="500"):
            await client.check(text="x")
