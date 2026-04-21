"""Surgical patch for standards_library.json.

Adds:
  1. GRM-06 standard entry (compound modifier hyphenation)
  2. CLR-01 content_type_notes._global (jargon/non-standard/vacuous guidance)

Usage:
    python3 patch_standards_library.py

Reads from: src/content_checker/standards/standards_library.json
Writes to:  src/content_checker/standards/standards_library.json (in place)

Safety: creates a .bak backup before writing. Never replaces the whole file.
"""

import json
import shutil
import sys
from pathlib import Path


def find_standards_library() -> Path:
    """Locate standards_library.json relative to this script or common paths."""
    candidates = [
        Path("src/content_checker/standards/standards_library.json"),
        Path("standards_library.json"),
        Path.home() / "Desktop/content-standards-checker/src/content_checker/standards/standards_library.json",
    ]
    for p in candidates:
        if p.exists():
            return p
    print("ERROR: Could not find standards_library.json")
    print("Run this script from the project root, or place it next to the file.")
    sys.exit(1)


def add_grm06(data: dict) -> bool:
    """Add GRM-06 to the Grammar category."""
    # Find Grammar category
    grammar_cat = None
    for cat in data["categories"]:
        cat_name = cat.get("name", cat.get("category", ""))
        if cat_name.lower() == "grammar":
            grammar_cat = cat
            break

    if grammar_cat is None:
        # Try matching by ID prefix in existing standards
        for cat in data["categories"]:
            for std in cat.get("standards", []):
                if std["id"].startswith("GRM-"):
                    grammar_cat = cat
                    break
            if grammar_cat:
                break

    if grammar_cat is None:
        print("ERROR: Could not find Grammar category")
        return False

    # Check if GRM-06 already exists
    for std in grammar_cat["standards"]:
        if std["id"] == "GRM-06":
            print("  GRM-06 already exists — skipping")
            return False

    grm06 = {
        "id": "GRM-06",
        "rule": "Hyphenate number-unit compound modifiers before nouns. The unit takes singular form when hyphenated.",
        "correct": "Start your 30-day free trial. | We offer a 2-hour workshop. | It's a one-time offer.",
        "incorrect": "Start your 30 day free trial. | We offer a 2 hours workshop. | It's a one time offer.",
        "rule_type": "mechanical",
        "checkable_from": "plain_text",
        "relevant_content_types": [
            "short_ui_copy", "long_form_copy", "heading",
            "tooltip_microcopy", "error_message", "confirmation"
        ]
    }

    # Insert after GRM-05 to maintain ID order
    insert_idx = None
    for i, std in enumerate(grammar_cat["standards"]):
        if std["id"] == "GRM-05":
            insert_idx = i + 1
            break

    if insert_idx is not None:
        grammar_cat["standards"].insert(insert_idx, grm06)
    else:
        grammar_cat["standards"].append(grm06)

    print("  ✓ Added GRM-06 (compound modifier hyphenation)")
    return True


def add_clr01_global_note(data: dict) -> bool:
    """Add _global content_type_notes to CLR-01."""
    for cat in data["categories"]:
        for std in cat.get("standards", []):
            if std["id"] == "CLR-01":
                if "content_type_notes" not in std:
                    std["content_type_notes"] = {}

                if "_global" in std["content_type_notes"]:
                    print("  CLR-01._global note already exists — skipping")
                    return False

                std["content_type_notes"]["_global"] = (
                    "CLR-01 covers three distinct failure modes. Match your suggestion "
                    "to the actual problem: (1) Jargon — domain-specific terms the "
                    "audience won't know. Suggest a plain-language equivalent. "
                    "(2) Non-standard English — unnecessarily complex words with "
                    "simpler alternatives (e.g., 'utilize' → 'use'). Name the simpler "
                    "word. (3) Vacuous copy — filler phrases that add no meaning "
                    "(e.g., 'in order to' → 'to'). Suggest removing or tightening."
                )
                print("  ✓ Added CLR-01._global content_type_notes")
                return True

    print("ERROR: Could not find CLR-01")
    return False


def main():
    path = find_standards_library()
    print(f"Patching: {path}")

    with open(path) as f:
        data = json.load(f)

    original_count = data.get("total_standards", 0)

    # Backup
    backup = path.with_suffix(".json.bak")
    shutil.copy2(path, backup)
    print(f"Backup: {backup}")

    changes = 0

    if add_grm06(data):
        data["total_standards"] = original_count + 1
        changes += 1

    if add_clr01_global_note(data):
        changes += 1

    if changes == 0:
        print("No changes needed.")
        return

    with open(path, "w") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
        f.write("\n")

    print(f"\nDone. {changes} patch(es) applied. Standards count: {data['total_standards']}")


if __name__ == "__main__":
    main()
