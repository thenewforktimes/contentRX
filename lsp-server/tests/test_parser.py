"""Tests for `contentrx_lsp.parser.extract_strings`.

Tree-sitter parses real source — no mocking. Fast enough that the
whole suite runs under a second.
"""

from __future__ import annotations

import pytest

from contentrx_lsp.parser import ExtractedString, extract_strings


def test_extracts_jsx_text_children():
    source = "<Button>Click here</Button>"
    results = extract_strings(source)
    assert len(results) == 1
    r = results[0]
    assert r.kind == "jsx_text"
    assert r.text == "Click here"
    # Range points at the trimmed text only.
    assert source[r.start_byte : r.end_byte] == "Click here"


def test_extracts_jsx_attribute_copy():
    source = '<img alt="A red apple" src="/apple.png" />'
    results = extract_strings(source)
    texts = {r.text for r in results}
    assert "A red apple" in texts
    # src is not on the _COPY_ATTRS list.
    assert "/apple.png" not in texts


def test_extracts_aria_label():
    source = '<button aria-label="Close dialog">X</button>'
    results = extract_strings(source)
    texts = [(r.text, r.attribute_name) for r in results]
    assert ("Close dialog", "aria-label") in texts


def test_skips_non_copy_attributes():
    source = '<a href="/docs" className="link" id="main-doc">Docs</a>'
    results = extract_strings(source)
    texts = {r.text for r in results}
    assert "Docs" in texts
    assert "/docs" not in texts
    assert "link" not in texts
    assert "main-doc" not in texts


def test_handles_expression_wrapped_string():
    # The curly braces form — `alt={"hello"}` — still resolves to
    # a string literal.
    source = '<img alt={"A red apple"} />'
    results = extract_strings(source)
    texts = {r.text for r in results}
    assert "A red apple" in texts


def test_skips_dynamic_attribute_values():
    # Dynamic values we can't safely lint from source text alone.
    source = "<img alt={altText} />"
    results = extract_strings(source)
    assert results == []


def test_ignores_pure_whitespace_text():
    # Between tags often contains only whitespace/newlines. Those
    # are noise — don't emit diagnostics on them.
    source = """
    <Button>
      Click here
    </Button>
    """
    results = extract_strings(source)
    texts = [r.text for r in results]
    assert texts == ["Click here"]


def test_handles_nested_jsx():
    source = """
    <div>
      <h1>Welcome</h1>
      <p>Get started below.</p>
    </div>
    """
    results = extract_strings(source)
    texts = {r.text for r in results}
    assert "Welcome" in texts
    assert "Get started below." in texts


def test_returns_empty_on_malformed_source():
    # Tree-sitter degrades gracefully on junk — the function should
    # not raise.
    results = extract_strings("<<<>notreal")
    assert isinstance(results, list)


def test_ranges_map_back_to_source():
    source = '<Button aria-label="Save">Go</Button>'
    results = extract_strings(source)
    for r in results:
        assert source[r.start_byte : r.end_byte] == r.text


def test_string_literal_attribute_strips_quotes():
    source = "<img alt='A red apple' />"
    results = extract_strings(source)
    assert results[0].text == "A red apple"
    # Range excludes the surrounding single quotes.
    assert source[results[0].start_byte : results[0].end_byte] == "A red apple"
