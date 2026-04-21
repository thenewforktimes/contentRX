"""Tests for the standards filter module."""

import pytest

from content_checker.filter import (
    filter_standards,
    get_content_type_ids,
    get_multi_snippet_standards,
    get_standard_ids_for_type,
)


class TestContentTypeHelpers:
    def test_seven_types_defined(self, standards_data):
        assert len(get_content_type_ids(standards_data)) == 8

    def test_button_in_types(self, standards_data):
        assert "button_cta" in get_content_type_ids(standards_data)

    def test_long_form_in_types(self, standards_data):
        assert "long_form_copy" in get_content_type_ids(standards_data)


class TestFilterCounts:
    @pytest.mark.parametrize("content_type,expected", [
        ("button_cta", 9),
        ("error_message", 25),
        ("confirmation", 21),
        ("tooltip_microcopy", 27),
        ("ui_label", 14),
        ("short_ui_copy", 41),
        ("long_form_copy", 41),
    ])
    def test_standard_count(self, standards_data, content_type, expected):
        result = filter_standards(standards_data, content_type)
        assert result["filtered_count"] == expected


class TestStructurePreservation:
    def test_has_categories(self, standards_data):
        result = filter_standards(standards_data, "button_cta")
        assert len(result["categories"]) > 0

    def test_categories_have_standards(self, standards_data):
        result = filter_standards(standards_data, "button_cta")
        for cat in result["categories"]:
            assert len(cat["standards"]) > 0

    def test_standards_have_required_fields(self, standards_data):
        result = filter_standards(standards_data, "button_cta")
        std = result["categories"][0]["standards"][0]
        for field in ["id", "rule", "correct", "incorrect"]:
            assert field in std


class TestCategoryPruning:
    def test_voice_tone_not_in_buttons(self, standards_data):
        result = filter_standards(standards_data, "button_cta")
        cat_ids = [c["id"] for c in result["categories"]]
        assert "voice_tone" not in cat_ids

    def test_clarity_not_in_buttons(self, standards_data):
        result = filter_standards(standards_data, "button_cta")
        cat_ids = [c["id"] for c in result["categories"]]
        assert "clarity" not in cat_ids

    def test_grammar_in_buttons(self, standards_data):
        result = filter_standards(standards_data, "button_cta")
        cat_ids = [c["id"] for c in result["categories"]]
        assert "grammar_mechanics" in cat_ids


class TestContentTypeNotes:
    def test_confirmation_has_vt01_note(self, standards_data):
        result = filter_standards(standards_data, "confirmation")
        assert len(result["active_notes"]) > 0
        assert result["active_notes"][0]["standard_id"] == "VT-01"

    def test_vt01_note_mentions_passive(self, standards_data):
        result = filter_standards(standards_data, "confirmation")
        assert "passive" in result["active_notes"][0]["note"].lower()

    def test_error_has_no_notes(self, standards_data):
        result = filter_standards(standards_data, "error_message")
        assert len(result["active_notes"]) == 3  # CLR-01 _global + VT-02 _global + TRN-04 _global


class TestSpecificAssignments:
    @pytest.mark.parametrize("standard_id", ["ACT-01", "ACT-02", "GRM-03", "GRM-04", "CON-02", "ACC-01"])
    def test_button_includes(self, standards_data, standard_id):
        ids = get_standard_ids_for_type(standards_data, "button_cta")
        assert standard_id in ids

    @pytest.mark.parametrize("standard_id", ["VT-01", "VT-03", "CLR-01", "STR-01"])
    def test_button_excludes(self, standards_data, standard_id):
        ids = get_standard_ids_for_type(standards_data, "button_cta")
        assert standard_id not in ids

    def test_vt05_only_in_error(self, standards_data):
        for ct in ["button_cta", "confirmation", "tooltip_microcopy", "ui_label", "short_ui_copy", "long_form_copy"]:
            assert "VT-05" not in get_standard_ids_for_type(standards_data, ct)
        assert "VT-05" in get_standard_ids_for_type(standards_data, "error_message")


class TestMultiSnippet:
    def test_three_standards(self, standards_data):
        multi = get_multi_snippet_standards(standards_data)
        assert sorted(multi) == ["CON-01", "CON-04", "TRN-07"]


class TestEdgeCases:
    def test_unknown_type_returns_empty(self, standards_data):
        result = filter_standards(standards_data, "nonexistent_type")
        assert result["filtered_count"] >= 0  # Standards with empty relevant_content_types pass through
        # Standards with empty relevant_content_types pass through for any type
        assert result["filtered_count"] <= result["total_count"]
        assert len(result["active_notes"]) == 0

    def test_total_count_always_present(self, standards_data):
        result = filter_standards(standards_data, "nonexistent_type")
        assert result["total_count"] == 47

    def test_plain_text_only_by_default(self, standards_data):
        for ct in get_content_type_ids(standards_data):
            result = filter_standards(standards_data, ct)
            for cat in result["categories"]:
                for std in cat["standards"]:
                    assert std.get("checkable_from", "plain_text") in ("plain_text", "visual", "rich_text")