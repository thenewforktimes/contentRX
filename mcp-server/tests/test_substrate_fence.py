"""Substrate-fence guards on the MCP check tools.

Per ADR 2026-04-25, MCP tool responses must not surface engine
substrate (`standard_id`, `rule_version`, `rationale_chain`,
`related_standards`, `docs_url`, raw `rule` text). /api/check already
strips these on the server side, but the MCP server must apply its
own fence as defense-in-depth — a regression upstream or a
PUBLIC_TAXONOMY=true mode flip can't be allowed to silently leak
substrate through the MCP boundary.

These tests inject substrate-laden CheckResults into the upstream
client and verify each MCP tool's projection drops them.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from contentrx_mcp.client import CheckResult
from contentrx_mcp import server as server_module


SUBSTRATE_FIELDS = (
    "standard_id",
    "standardId",
    "rule_version",
    "ruleVersion",
    "rationale_chain",
    "rationaleChain",
    "related_standards",
    "relatedStandards",
    "docs_url",
    "docsUrl",
    "rule",  # raw substrate rule text — public envelope keeps issue/suggestion only
)


class _FakeAsyncCtxClient:
    """Minimal stand-in for ContentRXClient that returns a canned
    CheckResult. Implements the async-context protocol the MCP tools
    use (`async with open_client() as c:`)."""

    def __init__(self, result: CheckResult):
        self._result = result

    async def __aenter__(self) -> "_FakeAsyncCtxClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def check(
        self,
        *,
        text: str,
        moment: str | None = None,
        content_type: str | None = None,
    ) -> CheckResult:
        _ = (text, moment, content_type)
        return self._result


def _violation_with_substrate() -> dict[str, Any]:
    """A single violation including every substrate field that has
    ever shown up in a /api/check response shape — past, present, or
    near-future. The fence must drop all of them."""
    return {
        "issue": "Link text is too vague.",
        "suggestion": "Replace with the destination noun.",
        "severity": "high",
        "confidence": 0.91,
        "category": "Accessibility",
        # Substrate that must NOT cross the MCP boundary:
        "standard_id": "ACC-01",
        "rule_version": "1.0.0",
        "rule": "Avoid 'click here' link text.",
        "related_standards": ["ACT-01"],
        "rationale_chain": [{"step": "scan", "verdict": "violation"}],
        "docs_url": "https://contentrx.io/standards/ACC-01",
        "ambiguity_flag": None,
    }


def _assert_no_substrate(blob: dict[str, Any] | list[Any]) -> None:
    """Recursive substrate fence — substring match on the JSON
    serialization. Catches both top-level keys and nested ones."""
    serialized = json.dumps(blob)
    leaks = [field for field in SUBSTRATE_FIELDS if f'"{field}"' in serialized]
    assert leaks == [], (
        f"MCP response leaked substrate field(s) {leaks}: {serialized}"
    )


@pytest.mark.asyncio
async def test_evaluate_copy_strips_substrate_from_violations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """evaluate_copy projects the violation explicitly. A buggy
    upstream that sends substrate-laden violations must NOT propagate
    those fields through the tool response."""
    canned = CheckResult(
        verdict="violation",
        review_reason=None,
        violations=[_violation_with_substrate()],
        warnings=[],
    )
    monkeypatch.setattr(
        server_module, "open_client", lambda: _FakeAsyncCtxClient(canned)
    )

    out = await server_module.evaluate_copy(text="Click here")

    # Public surface intact.
    assert out["verdict"] == "violation"
    assert len(out["violations"]) == 1
    v = out["violations"][0]
    assert v["issue"] == "Link text is too vague."
    assert v["suggestion"] == "Replace with the destination noun."
    assert v["severity"] == "high"
    assert v["severity_label"]  # humanize ran
    # Substrate fully stripped.
    _assert_no_substrate(out)


@pytest.mark.asyncio
async def test_evaluate_copy_batch_strips_substrate_from_violations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """evaluate_copy_batch shares the same projection as evaluate_copy.
    Same fence applies to per-string results in the batch envelope."""
    canned = CheckResult(
        verdict="violation",
        review_reason=None,
        violations=[_violation_with_substrate()],
        warnings=[],
    )
    monkeypatch.setattr(
        server_module, "open_client", lambda: _FakeAsyncCtxClient(canned)
    )

    out = await server_module.evaluate_copy_batch(
        ["Click here", "Submit"], dry_run=False
    )

    # Each batch result strips substrate independently.
    assert out["checks_used"] == 2
    for entry in out["results"]:
        assert "error" not in entry
        assert entry["verdict"] == "violation"
        for v in entry["violations"]:
            assert v["issue"]
            assert v["suggestion"]
    _assert_no_substrate(out)


@pytest.mark.asyncio
async def test_evaluate_copy_pass_path_carries_no_violations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A clean string returns verdict=pass with no violations. The
    fence applies trivially but the test pins the wire shape so a
    future regression that ships extra fields shows up here."""
    canned = CheckResult(
        verdict="pass",
        review_reason=None,
        violations=[],
        warnings=[],
    )
    monkeypatch.setattr(
        server_module, "open_client", lambda: _FakeAsyncCtxClient(canned)
    )

    out = await server_module.evaluate_copy(text="Save changes")
    assert out["verdict"] == "pass"
    assert out["violations"] == []
    _assert_no_substrate(out)
