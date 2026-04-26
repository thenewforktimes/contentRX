"""Tests for `contentrx_lsp.code_actions.plan_actions_for_diagnostic`.

Pure logic — we feed in the diagnostic `data` dict the server emits
and assert the action plans come out right. No pygls / LSP client /
HTTP involvement.

Schema 2.0.0 (ADR 2026-04-25): the `data` dict carries only public
fields (issue, suggestion, severity, byte offsets) — no
`standard_id`, `rule`, or `docs_url`. Actions are keyed off
issue/suggestion presence, not standard_id.
"""

from __future__ import annotations

from contentrx_lsp.code_actions import (
    CMD_APPLY_SUGGESTION,
    CMD_MARK_FALSE_POSITIVE,
    plan_actions_for_diagnostic,
)


def _violation_data(
    *,
    extracted_text: str = "Click here",
    issue: str = "Generic CTA",
    suggestion: str = "Try 'Start free trial'",
    severity: str = "high",
    start_byte: int = 0,
    end_byte: int = 10,
):
    return {
        "issue": issue,
        "suggestion": suggestion,
        "severity": severity,
        "extracted_text": extracted_text,
        "start_byte": start_byte,
        "end_byte": end_byte,
    }


def test_violation_yields_two_actions():
    plans = plan_actions_for_diagnostic(_violation_data(), "file:///foo.tsx")
    assert len(plans) == 2
    titles = [p.title for p in plans]
    assert any("Rewrite with ContentRX suggestion" in t for t in titles)
    assert any("Mark as false positive" in t for t in titles)
    # Schema 2.0.0: standard_id-keyed action titles are gone.
    for t in titles:
        assert "ACT-01" not in t
        assert "CLR-01" not in t


def test_no_show_rationale_action_in_2_0_0():
    """The pre-pivot 'Show standard rationale' action opened
    docs.contentrx.io/model/standards/<id> in the user's browser.
    Those pages don't exist in 2.0.0 — taxonomy is private.
    """
    plans = plan_actions_for_diagnostic(_violation_data(), "file:///foo.tsx")
    titles = [p.title for p in plans]
    assert "Show standard rationale" not in titles


def test_apply_suggestion_command_receives_public_payload():
    plans = plan_actions_for_diagnostic(_violation_data(), "file:///foo.tsx")
    apply = next(p for p in plans if p.command == CMD_APPLY_SUGGESTION)
    args = apply.arguments[0]
    assert args["uri"] == "file:///foo.tsx"
    assert args["text"] == "Click here"
    assert args["issue"] == "Generic CTA"
    assert args["current_suggestion"] == "Try 'Start free trial'"
    # Substrate fields must NOT be on the apply-suggestion arguments.
    for forbidden in ("standard_id", "rule", "rule_version", "docs_url"):
        assert forbidden not in args, f"{forbidden} leaked into apply args"


def test_mark_false_positive_command_receives_public_payload():
    plans = plan_actions_for_diagnostic(_violation_data(), "file:///foo.tsx")
    mark = next(p for p in plans if p.command == CMD_MARK_FALSE_POSITIVE)
    args = mark.arguments[0]
    assert args["text"] == "Click here"
    assert args["issue"] == "Generic CTA"
    for forbidden in ("standard_id", "rule", "rule_version", "docs_url"):
        assert forbidden not in args


def test_review_recommended_only_offers_false_positive():
    """REVIEW diagnostics have no actionable issue+suggestion pair, but
    a reviewer can still mark them as a false positive to dismiss the
    noise."""
    plans = plan_actions_for_diagnostic(
        {"extracted_text": "OK", "severity": "medium"},
        "file:///foo.tsx",
    )
    titles = [p.title for p in plans]
    assert titles == ["Mark as false positive"]


def test_missing_extracted_text_defaults_empty_string():
    plans = plan_actions_for_diagnostic(
        {"issue": "i", "suggestion": "s", "severity": "low"},
        "file:///foo.tsx",
    )
    apply = next(p for p in plans if p.command == CMD_APPLY_SUGGESTION)
    assert apply.arguments[0]["text"] == ""
