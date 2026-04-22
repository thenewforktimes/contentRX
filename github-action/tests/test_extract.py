"""Tests for the regex-based string extractor."""

from __future__ import annotations

from pathlib import Path

import pytest

from extract import (
    Extraction,
    extract_strings,
    matches_glob,
)


def _extract(content: str, name: str = "Component.tsx") -> list[Extraction]:
    return extract_strings(Path(name), source=content)


# ---------------------------------------------------------------------------
# JSX text nodes
# ---------------------------------------------------------------------------
def test_extracts_jsx_text() -> None:
    hits = _extract("<h1>Welcome back, friend</h1>")
    assert len(hits) == 1
    assert hits[0].text == "Welcome back, friend"
    assert hits[0].kind == "jsx-text"


def test_collapses_whitespace_in_jsx_text() -> None:
    hits = _extract(
        """<p>
            Your order
            is on the way.
        </p>"""
    )
    assert [h.text for h in hits] == ["Your order is on the way."]


def test_skips_script_and_style_inner_text() -> None:
    hits = _extract(
        """<style>.foo { color: red }</style>
           <script>console.log("hi")</script>
           <h1>Real copy</h1>"""
    )
    assert [h.text for h in hits] == ["Real copy"]


def test_skips_single_identifier_tokens() -> None:
    # `userName` is a variable reference, not copy
    hits = _extract("<span>userName</span>")
    assert hits == []


def test_skips_empty_and_punct_only() -> None:
    hits = _extract("<span>   </span><span>!!!</span><span>42</span>")
    assert hits == []


# ---------------------------------------------------------------------------
# Attribute values
# ---------------------------------------------------------------------------
def test_extracts_placeholder_attr() -> None:
    hits = _extract('<input placeholder="Enter your email" />')
    assert [h.text for h in hits] == ["Enter your email"]
    assert hits[0].kind == "attr:placeholder"


def test_extracts_aria_label_attr() -> None:
    hits = _extract('<button aria-label="Close the dialog">X</button>')
    # Both the attr AND the JSXText "X" — X is filtered out as too short.
    attr_hits = [h for h in hits if h.kind == "attr:aria-label"]
    assert attr_hits[0].text == "Close the dialog"


def test_extracts_single_quoted_attr() -> None:
    hits = _extract("<img alt='User avatar' />")
    attr_hits = [h for h in hits if h.kind == "attr:alt"]
    assert attr_hits[0].text == "User avatar"


def test_skips_non_copy_attrs() -> None:
    hits = _extract('<div className="text-sm font-bold" id="hero" />')
    assert hits == []


def test_skips_interpolated_values() -> None:
    hits = _extract('<h1 title="Welcome ${name}">hi</h1>')
    # The static JSXText "hi" is too short; the attr is skipped as dynamic.
    assert hits == []


# ---------------------------------------------------------------------------
# Dedup + line numbers
# ---------------------------------------------------------------------------
def test_line_numbers_are_1_indexed() -> None:
    source = "\n\n<h1>Line three</h1>"
    hits = _extract(source)
    assert hits[0].line == 3


def test_keeps_jsx_text_and_attr_for_same_string() -> None:
    # Same copy appearing in both the title attr and the inner text is a
    # realistic case (accessibility patterns). Both get emitted — different
    # kinds, so the dedup key differs.
    hits = _extract('<h1 title="Welcome back">Welcome back</h1>')
    kinds = sorted(h.kind for h in hits)
    assert kinds == ["attr:title", "jsx-text"]
    assert all(h.text == "Welcome back" for h in hits)


# ---------------------------------------------------------------------------
# Glob matching
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "path,pattern,expected",
    [
        ("src/components/Button.tsx", "**/*.{tsx,jsx,html}", True),
        ("src/components/Button.ts", "**/*.{tsx,jsx,html}", False),
        ("src/index.html", "**/*.{tsx,jsx,html}", True),
        ("pages/about.jsx", "**/*.{tsx,jsx,html}", True),
        ("test.py", "**/*.{tsx,jsx,html}", False),
    ],
)
def test_matches_glob(path: str, pattern: str, expected: bool) -> None:
    assert matches_glob(path, pattern) is expected
