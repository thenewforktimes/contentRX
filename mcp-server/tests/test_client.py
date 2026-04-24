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
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/check"
        body = json.loads(request.content.decode())
        assert body["text"] == "Click here"
        return httpx.Response(
            200,
            json={
                "result": {
                    "overall_verdict": "fail",
                    "content_type": "button_cta",
                    "moment": "decision_point",
                    "violations": [{"standard_id": "ACC-01", "issue": "vague"}],
                    "passes": [],
                    "summary": "Vague link text.",
                }
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.check(text="Click here")
    assert result.overall_verdict == "fail"
    assert result.content_type == "button_cta"
    assert result.moment == "decision_point"
    assert result.violations[0]["standard_id"] == "ACC-01"


@pytest.mark.asyncio
async def test_check_passes_through_rationale_chain():
    """Human-eval build plan Session 21 — the rationale chain must
    flow from /api/check all the way through to MCP clients so Claude
    Code / Cursor can narrate "why this verdict" without a second call.
    """

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "result": {
                    "overall_verdict": "review_recommended",
                    "verdict": "review_recommended",
                    "review_reason": "situation_ambiguity",
                    "content_type": "short_ui_copy",
                    "moment": "decision_point",
                    "violations": [],
                    "passes": [],
                    "summary": "",
                    "rationale_chain": [
                        {
                            "step": "classify",
                            "inputs": {"text": "Proceed?"},
                            "output": {"content_type": "short_ui_copy"},
                            "confidence": 0.9,
                            "rule_versions": {},
                            "ambiguity_flag": None,
                        },
                        {
                            "step": "detect_moment",
                            "inputs": {"text": "Proceed?"},
                            "output": {"moment": "decision_point"},
                            "confidence": 0.5,
                            "rule_versions": {},
                            "ambiguity_flag": "situation_uncertain",
                        },
                    ],
                }
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.check(text="Proceed?")
    assert result.verdict == "review_recommended"
    assert len(result.rationale_chain) == 2
    assert result.rationale_chain[0]["step"] == "classify"
    assert result.rationale_chain[1]["ambiguity_flag"] == "situation_uncertain"


@pytest.mark.asyncio
async def test_check_tolerates_missing_rationale_chain():
    """Pre-v1.2.0 responses still work — rationale_chain defaults to []."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "result": {
                    "overall_verdict": "pass",
                    "content_type": "button_cta",
                    "moment": "confirmation",
                    "violations": [],
                    "passes": [],
                    "summary": "",
                }
            },
        )

    client = _client_with(httpx.MockTransport(handler))
    async with client:
        result = await client.check(text="OK")
    assert result.rationale_chain == []


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
