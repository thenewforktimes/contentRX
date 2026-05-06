"""Verify CLI list output renders display_label, not substrate IDs.

Per ADR 2026-04-25, `contentrx example list` must not surface engine
substrate IDs. The `_format_entry_oneline` helper now prints
`label=Punctuation` instead of `std=GRM-04`. Custom team rules
(TEAM-NN) pass through unchanged because they're user-generated.
"""

from __future__ import annotations

from contentrx.example_cmd import _format_entry_oneline


def test_format_renders_display_label_not_substrate_id() -> None:
    out = _format_entry_oneline({
        "text": "Click here",
        "moment": None,
        "content_type": "button_cta",
        "standard_id": "ACC-01",
    })
    assert "label=Accessibility" in out
    assert "std=" not in out
    assert "ACC-01" not in out


def test_format_passes_through_team_custom_ids() -> None:
    """User-generated TEAM-NN ids are NOT substrate; they surface as
    themselves via the display_label_for fallback."""
    out = _format_entry_oneline({
        "text": "Some example",
        "moment": None,
        "content_type": "tooltip_microcopy",
        "standard_id": "TEAM-03",
    })
    assert "label=TEAM-03" in out


def test_format_omits_label_when_no_standard_id() -> None:
    out = _format_entry_oneline({
        "text": "Save",
        "moment": None,
        "content_type": "button_cta",
        "standard_id": None,
    })
    assert "label=" not in out
    assert "std=" not in out


def test_format_handles_camel_case_payload() -> None:
    """The API returns camelCase (`standardId`); the CLI list reader
    accepts either form."""
    out = _format_entry_oneline({
        "text": "Foo bar",
        "moment": "browsing_discovery",
        "contentType": "heading",
        "standardId": "VT-03",
    })
    assert "label=Tone" in out
    assert "moment=browsing_discovery" in out
    assert "type=heading" in out
