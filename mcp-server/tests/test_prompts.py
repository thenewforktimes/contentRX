"""Tests for the prompt builders."""

from __future__ import annotations

from contentrx_mcp.prompts import build_review_ui_copy_prompt


def test_default_prompt_falls_back_to_context_file_or_diff():
    out = build_review_ui_copy_prompt()
    assert "file or diff currently in context" in out
    assert "classify_moment(text)" in out
    assert "evaluate_copy(text" in out
    assert "Summary" in out
    assert "Violations by severity" in out


def test_focused_prompt_includes_provided_target():
    out = build_review_ui_copy_prompt(focus="src/app/dashboard/page.tsx")
    assert "src/app/dashboard/page.tsx" in out
    assert "file or diff currently in context" not in out


def test_blank_focus_uses_default():
    out = build_review_ui_copy_prompt(focus="   ")
    assert "file or diff currently in context" in out
