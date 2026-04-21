"""Standards filter — prunes the library by content type and audience.

Takes the full standards library and returns only the standards relevant
to the detected content type, with audience gating applied.
"""
from __future__ import annotations

import copy

from content_checker.audience import Audience, is_standard_active


# Content-type overrides for audience suppression.
# Some standards are suppressed in general audience mode but must remain
# active for specific content types. Each entry maps a standard ID to
# the set of content types that override the suppression.
#
# Evidence: RH-042 "What We Do" — CON-02 should flag title case in nav
# labels even when audience is general. Nav labels are structural UI
# elements regardless of the surrounding content surface.
_AUDIENCE_CONTENT_TYPE_OVERRIDES: dict[str, frozenset[str]] = {
    "CON-02": frozenset({"ui_label"}),
}


def get_content_type_ids(standards_data: dict) -> list[str]:
    """Return all valid content type IDs from the standards library.

    Used by the classifier and test suite to enumerate available types.
    """
    return [ct["id"] for ct in standards_data.get("content_types", [])]


def get_content_type_descriptions(standards_data: dict) -> dict[str, str]:
    """Extract content type descriptions from the standards library.

    Used by the classifier to know what types exist.
    """
    ct_list = standards_data.get("content_types", [])
    return {ct["id"]: ct.get("description", "") for ct in ct_list}


def get_standard_ids_for_type(standards_data: dict, content_type: str) -> list[str]:
    """Return a flat list of standard IDs relevant to a content type.

    Useful for validation and testing.
    """
    ids = []
    for cat in standards_data.get("categories", []):
        for std in cat.get("standards", []):
            if content_type in std.get("relevant_content_types", []):
                ids.append(std["id"])
    return ids


def get_multi_snippet_standards(standards_data: dict) -> list[str]:
    """Return standard IDs that require multi-snippet context.

    These standards (CON-01, CON-04, TRN-07) can only detect violations
    across multiple pieces of copy. In single-string mode, the engine
    should skip them or note the limitation.
    """
    ids = []
    for cat in standards_data.get("categories", []):
        for std in cat.get("standards", []):
            if std.get("requires_multi_snippet"):
                ids.append(std["id"])
    return ids


def filter_standards(
    standards_data: dict,
    content_type: str,
    audience: Audience | str = Audience.PRODUCT_UI,
) -> dict:
    """Filter standards to those relevant for the content type and audience.

    Returns a copy of the standards data with only relevant standards,
    plus metadata about what was filtered.
    """
    if isinstance(audience, str):
        audience = Audience.from_str(audience)

    filtered = copy.deepcopy(standards_data)
    total_count = 0
    filtered_count = 0
    active_notes = []

    new_categories = []
    for cat in filtered.get("categories", []):
        new_standards = []
        for std in cat.get("standards", []):
            total_count += 1
            relevant_types = std.get("relevant_content_types", [])

            # Content type filter
            if relevant_types and content_type not in relevant_types:
                continue

            # Audience filter — suppress UI-specific standards in general mode,
            # unless the content type has an explicit override (e.g., CON-02
            # stays active for ui_label even in general mode).
            if not is_standard_active(std["id"], audience):
                overrides = _AUDIENCE_CONTENT_TYPE_OVERRIDES.get(std["id"])
                if not overrides or content_type not in overrides:
                    continue

            filtered_count += 1
            new_standards.append(std)

            # Collect active content_type_notes for this standard.
            # _global notes apply regardless of content type (evaluation
            # guidance that should always reach the LLM). Content-type-
            # specific notes layer on top for targeted calibration.
            notes = std.get("content_type_notes", {})
            if "_global" in notes:
                active_notes.append({
                    "standard_id": std["id"],
                    "note": notes["_global"],
                })
            if content_type in notes:
                active_notes.append({
                    "standard_id": std["id"],
                    "note": notes[content_type],
                })

        if new_standards:
            cat_copy = dict(cat)
            cat_copy["standards"] = new_standards
            new_categories.append(cat_copy)

    filtered["categories"] = new_categories
    filtered["filtered_count"] = filtered_count
    filtered["total_count"] = total_count
    filtered["active_notes"] = active_notes

    return filtered
