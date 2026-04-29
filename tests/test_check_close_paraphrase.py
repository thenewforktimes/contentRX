"""Tests for tools/check_close_paraphrase.py.

Human-eval build plan Session 35. Pins the fuzzy-match behavior and
the attribution-exemption so lint behavior stays predictable as the
corpus grows.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools.check_close_paraphrase import (
    DEFAULT_THRESHOLD,
    Snippet,
    attributed_sources,
    find_matches,
    format_matches,
    normalise,
    similarity,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# normalise / similarity
# ---------------------------------------------------------------------------


def test_normalise_strips_punctuation_and_lowercases():
    assert normalise("Start with a verb!") == "start with a verb"


def test_normalise_collapses_whitespace():
    assert normalise("start   with  a\nverb") == "start with a verb"


def test_similarity_identical_returns_one():
    assert similarity("Start with a verb.", "start with a verb") == 1.0


def test_similarity_unrelated_is_low():
    ratio = similarity(
        "Use plain language.",
        "Format dates in ISO 8601.",
    )
    assert ratio < 0.5


def test_similarity_paraphrase_crosses_default_threshold():
    """Light paraphrase — word reorder + minor synonym swap — should
    cross the default threshold so the lint actually fires on this
    class of copy. The fixture pair here is a realistic
    "I lightly rephrased the source" example."""
    ratio = similarity(
        "Use plain language. Avoid jargon and acronyms.",
        "Write in plain language. Avoid jargon or acronyms.",
    )
    assert ratio >= DEFAULT_THRESHOLD


# ---------------------------------------------------------------------------
# attributed_sources
# ---------------------------------------------------------------------------


def test_attributed_sources_reads_sources_field():
    assert attributed_sources({"sources": ["Mailchimp", "GOV.UK Style Guide"]}) == {
        "Mailchimp",
        "GOV.UK Style Guide",
    }


def test_attributed_sources_empty_when_missing():
    assert attributed_sources({}) == set()


# ---------------------------------------------------------------------------
# find_matches
# ---------------------------------------------------------------------------


def _library(*standards: dict) -> dict:
    return {
        "categories": [
            {
                "id": "test",
                "standards": list(standards),
            }
        ]
    }


def test_find_matches_fires_when_paraphrase_lacks_attribution():
    lib = _library(
        {
            "id": "TST-01",
            "rule": "Start with a verb that describes the specific action.",
            "sources": [],
        }
    )
    snippets = [
        Snippet(
            source="Shopify Polaris",
            text="Start with a verb that describes the specific action.",
        )
    ]
    matches = find_matches(lib, snippets, threshold=DEFAULT_THRESHOLD)
    assert len(matches) == 1
    assert matches[0].standard_id == "TST-01"
    assert matches[0].source == "Shopify Polaris"
    assert matches[0].ratio >= 0.9


def test_find_matches_exempts_already_attributed_sources():
    """When the source is already in `sources`, the close-paraphrase
    check doesn't fire — the relationship is already disclosed."""
    lib = _library(
        {
            "id": "TST-01",
            "rule": "Start with a verb that describes the specific action.",
            "sources": ["Shopify Polaris"],
        }
    )
    snippets = [
        Snippet(
            source="Shopify Polaris",
            text="Start with a verb that describes the specific action.",
        )
    ]
    assert find_matches(lib, snippets, threshold=DEFAULT_THRESHOLD) == []


def test_find_matches_respects_threshold_boundary():
    lib = _library(
        {
            "id": "TST-02",
            "rule": "Be brief.",
            "sources": [],
        }
    )
    snippets = [
        Snippet(
            source="SomeSource",
            text="Be very brief and clear in all your product copy at all times.",
        )
    ]
    below = find_matches(lib, snippets, threshold=0.9)
    # High threshold → no match. Low threshold (0.1) → match.
    above = find_matches(lib, snippets, threshold=0.1)
    assert below == []
    assert len(above) == 1


def test_find_matches_sorts_by_ratio_desc():
    lib = _library(
        {
            "id": "TST-03",
            "rule": "Start with a verb that describes the specific action.",
            "sources": [],
        }
    )
    snippets = [
        Snippet(source="Close", text="Start with a verb that describes the specific action."),
        Snippet(source="Further", text="Start with a verb."),
    ]
    matches = find_matches(lib, snippets, threshold=0.3)
    assert len(matches) == 2
    assert matches[0].ratio >= matches[1].ratio


# ---------------------------------------------------------------------------
# format_matches — rendered warning text
# ---------------------------------------------------------------------------


def test_format_matches_empty_reports_no_warnings():
    assert format_matches([]).strip().startswith("No close-paraphrase warnings")


def test_format_matches_includes_standard_id_and_source():
    from tools.check_close_paraphrase import Match
    rendered = format_matches([
        Match(
            standard_id="TST-01",
            source="Polaris",
            ratio=0.88,
            rule_text="Rule text here.",
            snippet_text="Very close rule text here.",
            snippet_url="https://example.invalid/polaris",
        )
    ])
    assert "TST-01" in rendered
    assert "Polaris" in rendered
    assert "0.880" in rendered
    assert "https://example.invalid/polaris" in rendered


# ---------------------------------------------------------------------------
# Committed corpus sanity
# ---------------------------------------------------------------------------


def test_committed_corpus_has_source_and_text_keys():
    path = REPO_ROOT / "evals" / "external_source_snippets.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert "snippets" in raw
    for snip in raw["snippets"]:
        assert "source" in snip and snip["source"]
        assert "text" in snip and snip["text"]


def test_committed_corpus_does_not_trip_default_threshold_on_current_library():
    """The current library + the committed corpus should pass the
    default-threshold check. If this test fails, either the new
    standard that was added isn't attributed yet, or the new snippet
    was transcribed too close to a standard — both indicate a drift
    to fix."""
    library_path = REPO_ROOT / "src" / "content_checker" / "standards" / "private" / "standards_library.json"
    corpus_path = REPO_ROOT / "evals" / "external_source_snippets.json"
    library = json.loads(library_path.read_text(encoding="utf-8"))
    snippets_raw = json.loads(corpus_path.read_text(encoding="utf-8"))
    snippets = [
        Snippet(source=s["source"], text=s["text"], url=s.get("url"))
        for s in snippets_raw["snippets"]
    ]
    matches = find_matches(library, snippets, threshold=DEFAULT_THRESHOLD)
    assert matches == [], (
        "Close-paraphrase tool flagged warnings on the committed library + corpus.\n"
        + format_matches(matches)
    )
