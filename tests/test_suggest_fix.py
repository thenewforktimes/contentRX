"""Tests for `content_checker.suggest_fix`.

No live LLM calls — we monkey-patch `create_message` to return a
canned `LLMResponse` and assert the function shape + prompt
construction + wrapping-quote stripping behaviour.
"""

from __future__ import annotations

from unittest.mock import patch

from content_checker import suggest_fix as sf_module
from content_checker.api_utils import LLMResponse
from content_checker.suggest_fix import (
    SuggestFixResult,
    _build_system_prompt,
    _build_user_prompt,
    _strip_wrapping_quotes,
    suggest_fix,
)


def _fake_message(
    text: str, input_tokens: int = 50, output_tokens: int = 25
) -> LLMResponse:
    return LLMResponse(
        text=text,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def test_strip_wrapping_quotes_removes_double_quotes():
    assert _strip_wrapping_quotes('"Save changes"') == "Save changes"


def test_strip_wrapping_quotes_removes_single_quotes():
    assert _strip_wrapping_quotes("'Save changes'") == "Save changes"


def test_strip_wrapping_quotes_leaves_mismatched_pair():
    assert _strip_wrapping_quotes('"Save changes\'') == '"Save changes\''


def test_strip_wrapping_quotes_on_unquoted():
    assert _strip_wrapping_quotes("Save changes") == "Save changes"


def test_system_prompt_includes_standard_id():
    prompt = _build_system_prompt(
        standard_id="ACT-01",
        rule="Use a specific verb.",
        issue="Generic CTA",
    )
    assert "ACT-01" in prompt
    assert "Use a specific verb" in prompt
    assert "Generic CTA" in prompt


def test_system_prompt_without_rule_or_issue():
    prompt = _build_system_prompt(
        standard_id="ACT-01", rule=None, issue=None
    )
    assert "ACT-01" in prompt
    assert "Specific issue" not in prompt


def test_user_prompt_sentinel_delimits_text():
    prompt = _build_user_prompt(text="Click here", current_suggestion=None)
    assert "<<<TEXT" in prompt
    assert "TEXT>>>" in prompt
    assert "Click here" in prompt


def test_user_prompt_includes_engine_suggestion_when_provided():
    prompt = _build_user_prompt(
        text="Click here", current_suggestion="Use a specific verb"
    )
    assert "Use a specific verb" in prompt


def test_suggest_fix_returns_trimmed_text_and_token_counts():
    with patch.object(sf_module, "create_message") as m:
        m.return_value = _fake_message(text="  Start free trial  \n")
        result = suggest_fix(text="Click here", standard_id="ACT-01")
    assert isinstance(result, SuggestFixResult)
    assert result.rewritten == "Start free trial"
    assert result.input_tokens == 50
    assert result.output_tokens == 25
    assert result.latency_ms >= 0


def test_suggest_fix_strips_wrapping_quotes():
    with patch.object(sf_module, "create_message") as m:
        m.return_value = _fake_message(text='"Start free trial"')
        result = suggest_fix(text="Click here", standard_id="ACT-01")
    assert result.rewritten == "Start free trial"


def test_suggest_fix_passes_rule_and_issue_to_system_prompt():
    captured: dict = {}

    def fake_create(*, system: str, user: str, **kwargs):
        captured["system"] = system
        captured["user"] = user
        return _fake_message(text="Save changes")

    with patch.object(sf_module, "create_message", side_effect=fake_create):
        suggest_fix(
            text="Submit",
            standard_id="TN-02",
            rule="Use verbs that match the mental model.",
            issue="Submit is too passive",
            current_suggestion="Try 'Save changes'",
        )
    assert "TN-02" in captured["system"]
    assert "Use verbs that match the mental model." in captured["system"]
    assert "Submit is too passive" in captured["system"]
    assert "Try 'Save changes'" in captured["user"]
    assert "Submit" in captured["user"]
