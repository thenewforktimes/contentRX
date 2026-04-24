"""Tests for `contentrx_lsp.diagnostics`.

Pure-logic — no network, no tree-sitter, no pygls. Exercises the
byte-range → LSP-range translation (UTF-16 code units per spec) and
the violation → diagnostic mapping.
"""

from __future__ import annotations

from contentrx_lsp.diagnostics import (
    LspDiagnostic,
    byte_range_to_lsp_range,
    violations_to_diagnostics,
)
from contentrx_lsp.parser import ExtractedString


def _extracted(text: str = "Click here") -> ExtractedString:
    return ExtractedString(
        text=text,
        start_byte=0,
        end_byte=len(text.encode("utf-8")),
        kind="jsx_text",
    )


def test_byte_range_simple_ascii():
    source = "hello world"
    r = byte_range_to_lsp_range(source, 6, 11)
    assert r.start_line == 0
    assert r.start_char == 6
    assert r.end_line == 0
    assert r.end_char == 11


def test_byte_range_across_newline():
    source = "first line\nsecond line"
    # "second" starts at byte 11.
    r = byte_range_to_lsp_range(source, 11, 17)
    assert r.start_line == 1
    assert r.start_char == 0
    assert r.end_line == 1
    assert r.end_char == 6


def test_byte_range_with_multibyte_utf8():
    # "é" is 2 bytes in UTF-8, 1 UTF-16 code unit.
    source = "café\nhello"
    # byte range for "café": 0..5 (4 chars, but 'é' = 2 bytes)
    r = byte_range_to_lsp_range(source, 0, 5)
    assert r.start_line == 0
    assert r.start_char == 0
    assert r.end_line == 0
    assert r.end_char == 4


def test_byte_range_with_surrogate_pair():
    # "👋" is 4 bytes in UTF-8, 2 UTF-16 code units (surrogate pair).
    source = "👋 hi"
    r = byte_range_to_lsp_range(source, 0, 4)
    assert r.start_char == 0
    assert r.end_char == 2


def test_violations_emit_warning_severity():
    diagnostics = violations_to_diagnostics(
        "Click here",
        _extracted(),
        [
            {
                "standard_id": "ACT-01",
                "rule": "Use a specific verb",
                "issue": "Generic CTA",
                "suggestion": "Use 'Start free trial'",
            }
        ],
        verdict="violation",
    )
    assert len(diagnostics) == 1
    d = diagnostics[0]
    assert d.severity == 2  # warning
    assert d.code == "ACT-01"
    assert d.source == "ContentRX"
    assert "Generic CTA" in d.message
    assert "Start free trial" in d.message


def test_review_recommended_emit_info_severity():
    diagnostics = violations_to_diagnostics(
        "Click here",
        _extracted(),
        violations=[],
        verdict="review_recommended",
        review_reason="out_of_distribution",
    )
    assert len(diagnostics) == 1
    d = diagnostics[0]
    assert d.severity == 3  # info
    assert d.code == "REVIEW"
    assert "out of distribution" in d.message


def test_pass_verdict_emits_no_diagnostics():
    diagnostics = violations_to_diagnostics(
        "Click here",
        _extracted(),
        violations=[],
        verdict="pass",
    )
    assert diagnostics == []


def test_diagnostic_carries_docs_url_in_data():
    diagnostics = violations_to_diagnostics(
        "Click here",
        _extracted(),
        [
            {"standard_id": "ACT-01", "rule": "r", "issue": "i", "suggestion": "s"},
        ],
        verdict="violation",
    )
    assert diagnostics[0].data["docs_url"] == (
        "https://docs.contentrx.io/model/standards/ACT-01"
    )


def test_multiple_violations_become_multiple_diagnostics():
    diagnostics = violations_to_diagnostics(
        "Click here",
        _extracted(),
        [
            {"standard_id": "ACT-01", "rule": "r1", "issue": "i1"},
            {"standard_id": "TN-03", "rule": "r2", "issue": "i2"},
        ],
        verdict="violation",
    )
    assert {d.code for d in diagnostics} == {"ACT-01", "TN-03"}
