"""Tests for the server-level tool wrappers (PR-15).

The MCP server's `evaluate_copy`, `classify_moment`, etc. are largely
delegations to `ContentRXClient` (covered by `test_client.py`). This
file covers the wrappers' own logic — currently just
`evaluate_copy_batch`'s dry-run gate, which has no client interaction
and so isn't exercised by the client tests.
"""

from __future__ import annotations

import pytest

from contentrx_mcp.server import evaluate_copy_batch


@pytest.mark.asyncio
async def test_dry_run_returns_count_without_calls():
    """dry_run=true must NOT touch the client. We verify by checking
    the response shape — the dry-run path returns immediately so any
    accidental call would raise (no API key in the test env)."""
    out = await evaluate_copy_batch(
        ["Click here", "Are you sure?", "Submit"],
        dry_run=True,
    )
    assert out["dry_run"] is True
    assert out["string_count"] == 3
    assert out["would_use_checks"] == 3
    assert "3 checks" in out["message"]


@pytest.mark.asyncio
async def test_dry_run_singular_message():
    """Plural-aware copy: 1 check, not 1 checks."""
    out = await evaluate_copy_batch(["Save"], dry_run=True)
    assert out["string_count"] == 1
    assert out["would_use_checks"] == 1
    assert "1 check." in out["message"]
    assert "checks" not in out["message"].replace("1 check.", "")


@pytest.mark.asyncio
async def test_empty_list_short_circuits_without_dry_run():
    """An empty list returns an empty result envelope without making
    API calls — same behavior whether dry_run is set or not."""
    out = await evaluate_copy_batch([])
    assert out["results"] == []
    assert out["checks_used"] == 0
    assert out["terminated_early"] is False


@pytest.mark.asyncio
async def test_empty_list_with_dry_run():
    """Empty batch short-circuits to the empty-result envelope before
    the dry_run check is even read — saves the LLM from interpreting
    "would use 0 checks" framing for a no-op call."""
    out = await evaluate_copy_batch([], dry_run=True)
    assert out["results"] == []
    assert out["checks_used"] == 0


@pytest.mark.asyncio
async def test_dry_run_message_invites_followup():
    """Dry-run message must tell the LLM how to proceed once the user
    confirms — otherwise the user gets stuck staring at a count."""
    out = await evaluate_copy_batch(["a", "b", "c"], dry_run=True)
    assert "dry_run=false" in out["message"]
