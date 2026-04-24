"""Tests for `contentrx_lsp.code_actions.plan_actions_for_diagnostic`.

Pure logic — we feed in the diagnostic `data` dict the server emits
and assert the action plans come out right. No pygls / LSP client /
HTTP involvement.
"""

from __future__ import annotations

from contentrx_lsp.code_actions import (
    CMD_APPLY_SUGGESTION,
    CMD_MARK_FALSE_POSITIVE,
    plan_actions_for_diagnostic,
)


def _violation_data(
    *,
    standard_id: str = "ACT-01",
    docs_url: str = "https://docs.contentrx.io/model/standards/ACT-01",
    extracted_text: str = "Click here",
    rule: str = "Use a specific verb.",
    issue: str = "Generic CTA",
    suggestion: str = "Try 'Start free trial'",
):
    return {
        "standard_id": standard_id,
        "docs_url": docs_url,
        "extracted_text": extracted_text,
        "rule": rule,
        "issue": issue,
        "suggestion": suggestion,
    }


def test_violation_yields_three_actions():
    plans = plan_actions_for_diagnostic(_violation_data(), "file:///foo.tsx")
    assert len(plans) == 3
    titles = [p.title for p in plans]
    assert any("Rewrite to clear ACT-01" in t for t in titles)
    assert any("Show standard rationale" in t for t in titles)
    assert any("Mark as false positive" in t for t in titles)


def test_apply_suggestion_command_receives_full_payload():
    plans = plan_actions_for_diagnostic(_violation_data(), "file:///foo.tsx")
    apply = next(p for p in plans if p.command == CMD_APPLY_SUGGESTION)
    assert apply.arguments
    args = apply.arguments[0]
    assert args["uri"] == "file:///foo.tsx"
    assert args["standard_id"] == "ACT-01"
    assert args["text"] == "Click here"
    assert args["rule"] == "Use a specific verb."
    assert args["issue"] == "Generic CTA"
    assert args["current_suggestion"] == "Try 'Start free trial'"


def test_mark_false_positive_command_receives_payload():
    plans = plan_actions_for_diagnostic(_violation_data(), "file:///foo.tsx")
    mark = next(p for p in plans if p.command == CMD_MARK_FALSE_POSITIVE)
    assert mark.arguments[0]["standard_id"] == "ACT-01"
    assert mark.arguments[0]["text"] == "Click here"


def test_show_rationale_points_at_docs_url():
    plans = plan_actions_for_diagnostic(_violation_data(), "file:///foo.tsx")
    docs = next(p for p in plans if p.command == "vscode.open")
    assert (
        docs.arguments[0]
        == "https://docs.contentrx.io/model/standards/ACT-01"
    )


def test_review_recommended_skips_rewrite_and_override():
    # REVIEW diagnostics have no standard_id — only the rationale
    # (if docs_url is present) should show. Currently no docs_url,
    # so plans should be empty.
    plans = plan_actions_for_diagnostic(
        {"review_reason": "out_of_distribution", "extracted_text": "Ok"},
        "file:///foo.tsx",
    )
    assert plans == []


def test_missing_standard_still_yields_rationale_if_docs_url_present():
    # Defensive: if a future diagnostic shape sets only docs_url, the
    # rationale action should still appear. Today the server never
    # emits that shape, but we don't want to crash on it either.
    plans = plan_actions_for_diagnostic(
        {"docs_url": "https://docs.example/x"},
        "file:///foo.tsx",
    )
    # standard_id-dependent actions omitted; rationale present.
    titles = [p.title for p in plans]
    assert titles == ["Show standard rationale"]


def test_missing_extracted_text_defaults_empty_string():
    # Don't crash if the server sent no extracted_text in the data.
    plans = plan_actions_for_diagnostic(
        {"standard_id": "ACT-01"},
        "file:///foo.tsx",
    )
    apply = next(p for p in plans if p.command == CMD_APPLY_SUGGESTION)
    assert apply.arguments[0]["text"] == ""
