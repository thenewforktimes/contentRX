"""Tests for the prompt builders."""

from __future__ import annotations

from contentrx_mcp.prompts import (
    build_review_team_communication_prompt,
    build_review_ui_copy_prompt,
)


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


def test_team_communication_default_prompts_for_draft_or_context():
    """Phase F4 — review_team_communication. With no `draft`, the
    prompt asks the LLM to use the file/message in context or to
    request the draft from the user."""
    out = build_review_team_communication_prompt()
    assert "file or recent message in context" in out
    assert "ask the user to paste the draft" in out


def test_team_communication_includes_provided_draft():
    """Inline draft text round-trips through the prompt verbatim."""
    draft = "Hey team — heads up that the all hands moved to Wednesday."
    out = build_review_team_communication_prompt(draft=draft)
    assert draft in out
    assert "file or recent message in context" not in out


def test_team_communication_blank_draft_uses_default():
    out = build_review_team_communication_prompt(draft="   ")
    assert "file or recent message in context" in out


def test_team_communication_calls_evaluate_copy_once_not_per_string():
    """The prompt must instruct the LLM to call evaluate_copy ONCE on
    the entire draft. Per-string iteration would defeat the document-
    tier review the engine produces server-side for inputs >200 chars."""
    out = build_review_team_communication_prompt()
    # Single-call instruction:
    assert "Call `evaluate_copy(text)` once" in out
    # Negative pin: anti-pattern explicitly called out:
    assert "Don't split the draft into sentences" in out
    assert "don't loop per-paragraph" in out


def test_team_communication_renders_categorized_flags():
    """Long-form review surfaces flags grouped by `category`. The
    prompt names the common categories so the LLM doesn't invent
    categories the engine doesn't emit."""
    out = build_review_team_communication_prompt()
    assert "Flags by category" in out
    assert "Group `violations` by `category`" in out
    for category in [
        "Plain language",
        "Voice & tone",
        "Active voice",
        "Inclusive language",
        "Big picture",
    ]:
        assert category in out


def test_team_communication_includes_marketing_calibration_note():
    """The marketing-copy hedge is locked across surfaces (paste-mode
    banner, install-confirmation modal, PR comment footer in G3, and
    here in F4). The prompt's calibration note frames the same
    expectation for the LLM client."""
    out = build_review_team_communication_prompt()
    assert "calibrated" in out.lower()
    assert "product and internal writing" in out
    assert "marketing copy" in out
