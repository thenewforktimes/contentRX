"""Verify MCP tool responses surface display_label, not standard_id.

Per ADR 2026-04-25, substrate IDs (GRM-04, ACC-07, …) must not appear
in MCP tool response payloads. The `_team_rule_as_dict` and
`_example_as_dict` shapers now project to `display_label` instead.
Agents continue to identify rules / examples by row `id` for follow-
up calls; `standard_id` stays in the request body for write tools
(an agent supplying it isn't a leak — they're DRIVING the call).
"""

from __future__ import annotations

from datetime import datetime, timezone

from contentrx_mcp.client import CustomExample, TeamRule
from contentrx_mcp.server import _example_as_dict, _team_rule_as_dict


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def test_team_rule_response_has_display_label_no_standard_id() -> None:
    rule = TeamRule(
        id="rule_abc",
        standard_id="GRM-01",
        action="disable",
        rule_json={},
        created_at=_now(),
        updated_at=_now(),
    )
    out = _team_rule_as_dict(rule)
    assert "standard_id" not in out
    assert out["display_label"] == "Punctuation"
    # Row id stays — agents use it for update / remove calls.
    assert out["id"] == "rule_abc"


def test_team_rule_response_passes_through_team_custom_id() -> None:
    """User-generated TEAM-NN ids aren't substrate. They surface as the
    display label themselves (the fallback path of display_label_for)."""
    rule = TeamRule(
        id="rule_xyz",
        standard_id="TEAM-07",
        action="add",
        rule_json={"title": "No marketing speak"},
        created_at=_now(),
        updated_at=_now(),
    )
    out = _team_rule_as_dict(rule)
    assert out["display_label"] == "TEAM-07"


def test_example_response_has_display_label_no_standard_id() -> None:
    entry = CustomExample(
        id="ex_123",
        text="Click here",
        verdict="violation",
        moment=None,
        content_type="button_cta",
        standard_id="ACC-01",
        notes=None,
        contribute_upstream=False,
        created_at=_now(),
        updated_at=_now(),
    )
    out = _example_as_dict(entry)
    assert "standard_id" not in out
    assert out["display_label"] == "Accessibility"
    assert out["id"] == "ex_123"


def test_example_response_handles_null_standard_id() -> None:
    """Pass-verdict examples don't have a standard_id; the display
    label is empty string in that case."""
    entry = CustomExample(
        id="ex_pass",
        text="Save",
        verdict="pass",
        moment=None,
        content_type="button_cta",
        standard_id=None,
        notes=None,
        contribute_upstream=False,
        created_at=_now(),
        updated_at=_now(),
    )
    out = _example_as_dict(entry)
    assert out["display_label"] == ""
