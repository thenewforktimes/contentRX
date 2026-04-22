"""Tests for the markdown resource renderers."""

from __future__ import annotations

from contentrx_mcp.client import (
    MomentEntry,
    StandardDetail,
    StandardSummary,
    WeightedStandard,
)
from contentrx_mcp.resources import (
    render_moments_index,
    render_standard,
    render_standards_index,
)


def test_standards_index_includes_count_and_table():
    standards = [
        StandardSummary(id="CLR-01", rule="Use plain language.", rule_type="nuanced"),
        StandardSummary(id="GRM-06", rule="Hyphenate compound modifiers.", rule_type="hard"),
    ]
    out = render_standards_index(standards)
    assert "2 standards" in out
    assert "`CLR-01`" in out
    assert "`GRM-06`" in out
    assert "| --- | --- | --- |" in out
    # Pipe characters in rule text are escaped so the table doesn't break.
    pipe_std = StandardSummary(id="X-01", rule="A | B rule", rule_type="hard")
    out2 = render_standards_index([pipe_std])
    assert r"A \| B rule" in out2


def test_render_standard_minimal():
    detail = StandardDetail(
        id="CLR-01",
        rule="Use plain language.",
        correct=None,
        incorrect=None,
        rule_type=None,
        relevant_content_types=[],
        content_type_notes={},
        category_id="clarity",
        category_name="Clarity",
    )
    out = render_standard(detail)
    assert "# CLR-01" in out
    assert "Clarity" in out
    assert "Use plain language" in out


def test_render_standard_full():
    detail = StandardDetail(
        id="CLR-01",
        rule="Use plain language.",
        correct="Couldn't sign in.",
        incorrect="Authentication parameters were insufficient.",
        rule_type="nuanced",
        relevant_content_types=["error_message", "short_ui_copy"],
        content_type_notes={
            "_global": "Domain-mainstream terms (FDIC, GLP-1) are OK.",
            "error_message": "Empathy first.",
        },
        category_id="clarity",
        category_name="Clarity",
    )
    out = render_standard(detail)
    assert "## Pass example" in out
    assert "Couldn't sign in." in out
    assert "## Fail example" in out
    assert "## Relevant content types" in out
    assert "`error_message`" in out
    assert "## Notes by content type" in out
    assert "_All_" in out  # _global rendering


def test_render_moments_index_includes_weights():
    moments = [
        MomentEntry(
            id="error_recovery",
            description="Validation, system errors, failed states.",
            weighted_standards=[
                WeightedStandard(
                    standard_id="VT-05", modifier="emphasize", rationale="Show empathy."
                ),
                WeightedStandard(
                    standard_id="GRM-01", modifier="suppress", rationale="Less critical here."
                ),
            ],
        ),
        MomentEntry(
            id="browsing_discovery",
            description="Homepages, landing pages.",
            weighted_standards=[],
        ),
    ]
    out = render_moments_index(moments)
    assert "2 moments" in out
    assert "## `error_recovery`" in out
    assert "## `browsing_discovery`" in out
    assert "VT-05" in out
    assert "(emphasize)" in out
    assert "_No standards-weight adjustments — uses the defaults._" in out
