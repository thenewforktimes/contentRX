"""Structural invariants for the save-time team-rule classifier
(Project B, 2026-05-15).

No live API calls (project convention: the pytest suite is
deterministic). The classifier's LLM behaviour is exercised by the
opt-in `evals/rewrite_floor_eval.py` ban arm; here we pin the pure
parts the deterministic ban gate's safety rests on:

  - the asymmetric safe-failure (a misclassification must collapse to
    STYLISTIC, never to a false hard ban),
  - token coercion / dedupe / caps (a malformed-but-parseable object
    must not leak a bad ban into the matcher),
  - the prompt actually asks for the structured shape + the em-dash
    precision (U+2014 only) the derived matcher depends on,
  - user content is sentinel-wrapped (prompt-injection defence).
"""

from __future__ import annotations

import inspect

from content_checker.api_utils import USER_TEXT_SENTINEL_OPEN
from content_checker.classify_team_rule import (
    _MAX_BAN_TOKENS,
    _MAX_TOKEN_CHARS,
    TeamRuleClassification,
    _build_system_prompt,
    _build_user_prompt,
    _coerce,
    classify_team_rule,
)

_USAGE = {
    "latency_ms": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
}


# ---------------------------------------------------------------------------
# Safe-failure is asymmetric: ambiguity ⇒ stylistic, never a false ban.
# ---------------------------------------------------------------------------

def test_stylistic_factory_is_a_no_ban_result() -> None:
    s = TeamRuleClassification.stylistic(**_USAGE)
    assert s.is_ban is False
    assert s.ban_tokens == ()
    assert s.leave_proper_nouns is False


def test_not_a_ban_returns_stylistic_and_keeps_directive() -> None:
    out = _coerce(
        {"is_ban": False, "stylistic_directive": "Keep it warm and brief."},
        _USAGE,
    )
    assert out.is_ban is False
    assert out.ban_tokens == ()
    assert out.stylistic_directive == "Keep it warm and brief."


def test_ban_with_no_usable_token_collapses_to_stylistic() -> None:
    # Model claimed a ban but produced nothing matchable. A tokenless
    # "ban" the matcher can't enforce must NEVER be treated as a ban.
    out = _coerce(
        {"is_ban": True, "ban_tokens": [], "stylistic_directive": "x"},
        _USAGE,
    )
    assert out.is_ban is False
    assert out.ban_tokens == ()
    assert out.stylistic_directive == "x"


def test_ban_tokens_garbage_types_collapse_to_stylistic() -> None:
    out = _coerce(
        {"is_ban": True, "ban_tokens": [None, 5, {"x": 1}, "   "]},
        _USAGE,
    )
    assert out.is_ban is False
    assert out.ban_tokens == ()


def test_missing_is_ban_is_falsey_not_a_ban() -> None:
    out = _coerce({"ban_tokens": ["guys"]}, _USAGE)
    assert out.is_ban is False


# ---------------------------------------------------------------------------
# Token coercion: dedupe (casefold), whitespace-collapse, caps.
# ---------------------------------------------------------------------------

def test_ban_tokens_normalized_and_deduped() -> None:
    out = _coerce(
        {
            "is_ban": True,
            "ban_tokens": ["guys", "  guys ", "GUYS", "guy"],
            "leave_proper_nouns": True,
        },
        _USAGE,
    )
    assert out.is_ban is True
    # casefold dedupe collapses guys/ guys /GUYS; "guy" stays distinct.
    assert out.ban_tokens == ("guys", "guy")
    assert out.leave_proper_nouns is True


def test_internal_whitespace_collapsed() -> None:
    out = _coerce(
        {"is_ban": True, "ban_tokens": ["best   in    class"]},
        _USAGE,
    )
    assert out.ban_tokens == ("best in class",)


def test_overlong_token_dropped_but_others_kept() -> None:
    long = "x" * (_MAX_TOKEN_CHARS + 5)
    out = _coerce(
        {"is_ban": True, "ban_tokens": [long, "guys"]},
        _USAGE,
    )
    assert out.ban_tokens == ("guys",)


def test_token_count_capped() -> None:
    toks = [f"tok{i}" for i in range(_MAX_BAN_TOKENS + 20)]
    out = _coerce({"is_ban": True, "ban_tokens": toks}, _USAGE)
    assert len(out.ban_tokens) == _MAX_BAN_TOKENS


def test_em_dash_token_survives_coercion_verbatim() -> None:
    # The derived matcher treats the em dash as a literal char; the
    # classifier must hand it through unmangled (NOT lowercased away,
    # NOT whitespace-eaten).
    out = _coerce({"is_ban": True, "ban_tokens": ["—"]}, _USAGE)
    assert out.ban_tokens == ("—",)


# ---------------------------------------------------------------------------
# Prompt contract: asks for the structured shape + matcher-critical
# precision, and wraps user content.
# ---------------------------------------------------------------------------

def test_system_prompt_requests_the_structured_keys() -> None:
    p = _build_system_prompt()
    for key in (
        "is_ban",
        "ban_tokens",
        "leave_proper_nouns",
        "stylistic_directive",
    ):
        assert key in p
    # The single-JSON-object contract parse_llm_json depends on.
    assert "SINGLE JSON object" in p


def test_system_prompt_pins_em_dash_precision() -> None:
    """deriveBanMatcher treats the em dash as a literal; a classifier
    that returned the en dash instead would silently ban the wrong
    character. The prompt must call this out."""
    p = _build_system_prompt()
    assert "U+2014" in p
    assert "U+2013" in p  # explicitly named as the one NOT to include


def test_user_prompt_sentinel_wraps_rule_and_title() -> None:
    u = _build_user_prompt(rule_text="never say guys", title="No slang")
    assert USER_TEXT_SENTINEL_OPEN in u
    assert "never say guys" in u
    assert "No slang" in u


def test_user_prompt_omits_empty_title_block() -> None:
    u = _build_user_prompt(rule_text="never say guys", title=None)
    assert "Rule title" not in u
    assert "never say guys" in u


def test_classify_team_rule_signature_is_stable() -> None:
    """Pin the call shape /api/evaluate depends on so a refactor can't
    silently drop the kwargs."""
    sig = inspect.signature(classify_team_rule)
    assert "rule_text" in sig.parameters
    assert "title" in sig.parameters
    assert sig.parameters["title"].default is None
