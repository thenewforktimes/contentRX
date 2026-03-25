"""Standards filter for the content standards checker.

Filters the standards library down to only the standards relevant to a given
content type. Returns a pruned copy of the standards data in the same structure,
so build_system_prompt works without changes.

Also surfaces content_type_notes for standards that have context-specific
evaluation guidance (e.g., VT-01's note that passive voice is acceptable
in confirmations).
"""

import copy
import json
from pathlib import Path


def filter_standards(standards_data, content_type, include_all=False):
    """Return a filtered copy of standards_data for the given content type.

    Only includes standards where:
    - content_type is in the standard's relevant_content_types list
    - checkable_from is "plain_text" (unless include_all=True)

    Categories with no remaining standards are dropped.

    Returns:
        dict with same structure as standards_data, plus:
        - "active_notes": list of {standard_id, note} for standards with
          content_type_notes matching this content type
        - "filtered_count": number of standards included
        - "total_count": number of standards before filtering
    """
    filtered = {
        "version": standards_data.get("version"),
        "content_types": standards_data.get("content_types", []),
        "categories": [],
        "active_notes": [],
        "filtered_count": 0,
        "total_count": 0,
    }

    for cat in standards_data["categories"]:
        filtered_standards = []

        for std in cat["standards"]:
            filtered["total_count"] += 1

            # Skip non-plain-text standards unless include_all
            if not include_all and std.get("checkable_from", "plain_text") != "plain_text":
                continue

            # Check if this standard applies to the content type
            relevant_types = std.get("relevant_content_types", [])
            if content_type not in relevant_types:
                continue

            # Include this standard
            filtered_standards.append(std)
            filtered["filtered_count"] += 1

            # Collect any content-type-specific notes
            notes = std.get("content_type_notes", {})
            if content_type in notes:
                filtered["active_notes"].append({
                    "standard_id": std["id"],
                    "note": notes[content_type],
                })

        # Only include the category if it has standards after filtering
        if filtered_standards:
            filtered["categories"].append({
                "id": cat["id"],
                "name": cat["name"],
                "standards": filtered_standards,
            })

    return filtered


def get_content_type_ids(standards_data):
    """Return the list of valid content type IDs from the standards library."""
    return [ct["id"] for ct in standards_data.get("content_types", [])]


def get_content_type_descriptions(standards_data):
    """Return content type definitions for use in the LLM classifier prompt.

    Returns a list of dicts with id, name, and description.
    """
    return standards_data.get("content_types", [])


def get_standard_ids_for_type(standards_data, content_type):
    """Return a flat list of standard IDs relevant to a content type.

    Useful for validation and testing.
    """
    ids = []
    for cat in standards_data["categories"]:
        for std in cat["standards"]:
            if content_type in std.get("relevant_content_types", []):
                ids.append(std["id"])
    return ids


def get_multi_snippet_standards(standards_data):
    """Return standard IDs that require multi-snippet context.

    These standards (CON-01, CON-04, TRN-07) can only detect violations
    across multiple pieces of copy. In single-string mode, the engine
    should skip them or note the limitation.
    """
    ids = []
    for cat in standards_data["categories"]:
        for std in cat["standards"]:
            if std.get("requires_multi_snippet"):
                ids.append(std["id"])
    return ids


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Load the v4 standards library
    lib_path = Path(__file__).parent / "standards_library.json"
    if not lib_path.exists():
        print(f"Standards library not found at {lib_path}")
        exit(1)

    with open(lib_path) as f:
        data = json.load(f)

    print("Running filter self-tests...\n")
    counts = {"passed": 0, "failed": 0}

    def test(name, actual, expected):
        ok = actual == expected
        icon = "✓" if ok else "✗"
        color = "\033[32m" if ok else "\033[31m"
        print(f"  {color}{icon}\033[0m {name}")
        if not ok:
            print(f"    expected: {expected}")
            print(f"    actual:   {actual}")
            counts["failed"] += 1
        else:
            counts["passed"] += 1

    # --- Content type ID helpers ---
    print("Content type helpers")
    valid_types = get_content_type_ids(data)
    test("7 content types defined", len(valid_types), 7)
    test("button_cta in types", "button_cta" in valid_types, True)
    test("long_form_copy in types", "long_form_copy" in valid_types, True)

    # --- Filter counts per content type ---
    print("\nFilter counts (checkable standards only)")

    expected_counts = {
        "button_cta": 6,
        "error_message": 21,
        "confirmation": 17,
        "tooltip_microcopy": 23,
        "ui_label": 11,
        "short_ui_copy": 37,
        "long_form_copy": 37,
    }

    for ct, expected in expected_counts.items():
        result = filter_standards(data, ct)
        actual = result["filtered_count"]
        test(f"{ct}: {actual} standards", actual, expected)

    # --- Structure preservation ---
    print("\nStructure preservation")
    button_result = filter_standards(data, "button_cta")

    # Should have categories
    test("button has categories", len(button_result["categories"]) > 0, True)

    # Each category should have standards
    for cat in button_result["categories"]:
        test(
            f"category '{cat['name']}' has standards",
            len(cat["standards"]) > 0,
            True,
        )

    # Standards should have all required fields
    first_std = button_result["categories"][0]["standards"][0]
    for field in ["id", "rule", "correct", "incorrect"]:
        test(f"standard has '{field}' field", field in first_std, True)

    # --- Empty categories are dropped ---
    print("\nCategory pruning")
    button_cats = [c["id"] for c in button_result["categories"]]
    test(
        "voice_tone NOT in button categories",
        "voice_tone" not in button_cats,
        True,
    )
    test(
        "clarity NOT in button categories",
        "clarity" not in button_cats,
        True,
    )
    test(
        "grammar_mechanics in button categories",
        "grammar_mechanics" in button_cats,
        True,
    )

    # --- Content type notes ---
    print("\nContent type notes")
    confirm_result = filter_standards(data, "confirmation")
    test(
        "confirmation has VT-01 note",
        len(confirm_result["active_notes"]) > 0,
        True,
    )
    test(
        "VT-01 note standard_id",
        confirm_result["active_notes"][0]["standard_id"],
        "VT-01",
    )
    test(
        "VT-01 note mentions passive voice",
        "passive" in confirm_result["active_notes"][0]["note"].lower(),
        True,
    )

    # No notes for content types without them
    error_result = filter_standards(data, "error_message")
    test(
        "error_message has no active notes",
        len(error_result["active_notes"]),
        0,
    )

    # --- Specific standard assignments ---
    print("\nSpecific standard assignments")
    button_ids = get_standard_ids_for_type(data, "button_cta")
    test("ACT-01 in button", "ACT-01" in button_ids, True)
    test("ACT-02 in button", "ACT-02" in button_ids, True)
    test("GRM-03 in button", "GRM-03" in button_ids, True)
    test("GRM-04 in button", "GRM-04" in button_ids, True)
    test("CON-02 in button", "CON-02" in button_ids, True)
    test("ACC-01 in button", "ACC-01" in button_ids, True)
    test("VT-01 NOT in button", "VT-01" not in button_ids, True)
    test("VT-03 NOT in button", "VT-03" not in button_ids, True)
    test("CLR-01 NOT in button", "CLR-01" not in button_ids, True)
    test("STR-01 NOT in button", "STR-01" not in button_ids, True)

    error_ids = get_standard_ids_for_type(data, "error_message")
    test("VT-05 in error", "VT-05" in error_ids, True)
    test("VT-01 in error", "VT-01" in error_ids, True)
    test("ACT-03 in error", "ACT-03" in error_ids, True)

    label_ids = get_standard_ids_for_type(data, "ui_label")
    test("CON-02 in label", "CON-02" in label_ids, True)
    test("ACT-01 in label", "ACT-01" in label_ids, True)
    test("CLR-01 NOT in label", "CLR-01" not in label_ids, True)

    long_ids = get_standard_ids_for_type(data, "long_form_copy")
    test("STR-01 in long_form", "STR-01" in long_ids, True)
    test("STR-05 in long_form", "STR-05" in long_ids, True)
    test("STR-04 NOT in long_form", "STR-04" not in long_ids, True)

    # VT-05 should only be in error_message
    for ct in ["button_cta", "confirmation", "tooltip_microcopy", "ui_label", "short_ui_copy", "long_form_copy"]:
        ct_ids = get_standard_ids_for_type(data, ct)
        test(f"VT-05 NOT in {ct}", "VT-05" not in ct_ids, True)

    # --- Multi-snippet standards ---
    print("\nMulti-snippet standards")
    multi = get_multi_snippet_standards(data)
    test("CON-01 requires multi-snippet", "CON-01" in multi, True)
    test("CON-04 requires multi-snippet", "CON-04" in multi, True)
    test("TRN-07 requires multi-snippet", "TRN-07" in multi, True)
    test("exactly 3 multi-snippet standards", len(multi), 3)

    # --- Non-plain-text standards excluded by default ---
    print("\nNon-plain-text exclusion")
    for ct in valid_types:
        result = filter_standards(data, ct)
        for cat in result["categories"]:
            for std in cat["standards"]:
                test(
                    f"{std['id']} in {ct} is plain_text",
                    std.get("checkable_from", "plain_text"),
                    "plain_text",
                )

    # include_all=True should include them (if they had content types assigned)
    # ACC-05, ACC-06, STR-06 have empty relevant_content_types, so they
    # still won't appear — but the flag shouldn't crash
    all_result = filter_standards(data, "long_form_copy", include_all=True)
    test(
        "include_all doesn't crash",
        all_result["filtered_count"] >= 0,
        True,
    )

    # --- Unknown content type returns empty ---
    print("\nEdge cases")
    unknown = filter_standards(data, "nonexistent_type")
    test("unknown type returns 0 standards", unknown["filtered_count"], 0)
    test("unknown type has no categories", len(unknown["categories"]), 0)
    test("unknown type has no notes", len(unknown["active_notes"]), 0)
    test("total_count still correct", unknown["total_count"], 46)

    # --- Summary ---
    print(f"\n{'='*40}")
    print(f"Passed: {counts['passed']}  Failed: {counts['failed']}")
    if counts["failed"] == 0:
        print("\033[32mAll tests passed.\033[0m")
    else:
        print(f"\033[31m{counts['failed']} test(s) failed.\033[0m")
