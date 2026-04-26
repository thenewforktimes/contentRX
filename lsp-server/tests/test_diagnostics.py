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
                "issue": "Generic CTA",
                "suggestion": "Use 'Start free trial'",
                "severity": "high",
                "confidence": 0.9,
            }
        ],
        verdict="violation",
    )
    assert len(diagnostics) == 1
    d = diagnostics[0]
    assert d.severity == 2  # warning
    # Schema 2.0.0 — `code` is the severity band, not the substrate
    # standard_id. Editors render `code` visibly in the problem panel,
    # so it cannot leak the rule taxonomy.
    assert d.code == "HIGH"
    assert d.source == "ContentRX"
    assert "Generic CTA" in d.message
    assert "Start free trial" in d.message
    # Substrate fields must NEVER appear in the message — editors
    # render that string inline in the editor.
    assert "ACT-01" not in d.message


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


def test_diagnostic_data_carries_only_public_fields():
    """Schema 2.0.0: the `data` blob attached to each diagnostic must
    not carry standard_id, rule, rule_version, related_standards,
    docs_url, or any other substrate field. The apply-suggestion code
    action keys on issue+suggestion+byte offsets only.
    """
    diagnostics = violations_to_diagnostics(
        "Click here",
        _extracted(),
        [
            {
                "issue": "i",
                "suggestion": "s",
                "severity": "medium",
                "confidence": 0.7,
            }
        ],
        verdict="violation",
    )
    data = diagnostics[0].data
    assert data["issue"] == "i"
    assert data["suggestion"] == "s"
    assert data["severity"] == "medium"
    for forbidden in (
        "standard_id",
        "rule",
        "rule_version",
        "related_standards",
        "docs_url",
        "violation",
    ):
        assert forbidden not in data, f"{forbidden} leaked into LSP data"


def test_multiple_violations_become_multiple_diagnostics():
    diagnostics = violations_to_diagnostics(
        "Click here",
        _extracted(),
        [
            {
                "issue": "i1",
                "suggestion": "s1",
                "severity": "high",
                "confidence": 0.9,
            },
            {
                "issue": "i2",
                "suggestion": "s2",
                "severity": "medium",
                "confidence": 0.7,
            },
        ],
        verdict="violation",
    )
    # `code` is the severity band, not the standard_id.
    assert {d.code for d in diagnostics} == {"HIGH", "MEDIUM"}
