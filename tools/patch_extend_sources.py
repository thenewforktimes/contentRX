"""Surgical patch: extend `sources` on standards with conservative
attribution to canonical public style guides. Human-eval build plan
Session 16.

Only adds attributions where the principle is demonstrably canonical
across multiple public style guides — never a single-system guess.
Conservative by design: leaves attribution empty where the mapping
requires domain expertise I don't have.

Safe to re-run: skips standards that already have the attribution
we'd add. Backs up to .bak before writing. Never replaces the file
structure.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


LIBRARY_PATH = Path("src/content_checker/standards/standards_library.json")


# Conservative attribution map. Each entry: standard_id → sources to add.
#
# Principles for inclusion:
#   - The rule must articulate a principle that multiple canonical
#     public style guides explicitly codify.
#   - Attribution names the systems whose PUBLIC documentation clearly
#     states the same principle.
#   - Uncertain mappings are OMITTED here — Robo's review pass fills
#     them based on his reading.
#
# Sources use short canonical names matching the examples corpus.
CONSERVATIVE_ATTRIBUTIONS: dict[str, list[str]] = {
    # Clarity / plain language — canonical across all public plain-lang guides.
    "CLR-01": ["Mailchimp", "GOV.UK Style Guide", "18F Content Guide",
               "Microsoft Writing Style Guide", "USWDS"],
    "CLR-02": ["Mailchimp", "GOV.UK Style Guide"],
    "CLR-03": ["GOV.UK Style Guide", "Microsoft Writing Style Guide"],
    "CLR-04": ["Atlassian Design System", "Microsoft Writing Style Guide"],
    "CLR-05": ["GOV.UK Style Guide", "18F Content Guide"],

    # Voice and tone — voice = active, empathy, personal pronouns are
    # widely codified.
    "VT-01": ["Microsoft Writing Style Guide", "Mailchimp",
              "Atlassian Design System"],
    "VT-02": ["Mailchimp", "GOV.UK Style Guide",
              "Microsoft Writing Style Guide"],
    "VT-03": ["Atlassian Design System", "Mailchimp"],
    "VT-04": ["Apple HIG", "Mailchimp"],
    "VT-05": ["Mailchimp", "Shopify Polaris",
              "Atlassian Design System"],

    # Action-oriented buttons/CTAs — near-universal.
    "ACT-01": ["Apple HIG", "Material Design", "Shopify Polaris",
               "Microsoft Writing Style Guide"],

    # Accessibility — link text + ALT CAPS rules are canonical.
    "ACC-01": ["GOV.UK Style Guide", "GitHub Primer", "USWDS"],

    # Grammar and mechanics — numerals, exclamations, caps.
    "GRM-01": ["GitHub Primer", "USWDS", "Microsoft Writing Style Guide"],
    "GRM-03": ["Mailchimp", "Shopify Polaris",
               "Microsoft Writing Style Guide", "Apple HIG"],
    "GRM-05": ["Mailchimp", "Microsoft Writing Style Guide",
               "Chicago Manual of Style"],

    # Consistency — sentence case in UI is codified by everyone modern.
    "CON-02": ["Mailchimp", "GitHub Primer",
               "Microsoft Writing Style Guide",
               "Google Developer Documentation Style Guide", "Apple HIG"],

    # Proofing — trailing-period and all-caps conventions are widely documented.
    "PRF-03": ["Mailchimp", "Microsoft Writing Style Guide"],
    "PRF-09": ["Mailchimp", "Microsoft Writing Style Guide"],
    "PRF-11": ["Mailchimp", "Atlassian Design System"],
}


def iter_standards(data: dict):
    for cat in data.get("categories", []):
        for std in cat.get("standards", []):
            yield std


def patch(data: dict) -> tuple[int, list[str]]:
    """Returns (number of standards modified, log messages)."""
    patched = 0
    log: list[str] = []
    for std in iter_standards(data):
        sid = std.get("id")
        if sid not in CONSERVATIVE_ATTRIBUTIONS:
            continue
        existing = set(std.get("sources", []) or [])
        to_add = CONSERVATIVE_ATTRIBUTIONS[sid]
        new_sources = list(existing)
        added_any = False
        for source in to_add:
            if source not in existing:
                new_sources.append(source)
                added_any = True
        if added_any:
            std["sources"] = new_sources
            patched += 1
            log.append(f"  {sid}: +{len(new_sources) - len(existing)} sources")
    return patched, log


def main() -> int:
    if not LIBRARY_PATH.exists():
        print(f"ERROR: {LIBRARY_PATH} not found. Run from repo root.")
        return 1

    with open(LIBRARY_PATH) as f:
        data = json.load(f)

    patched, log = patch(data)
    if patched == 0:
        print("No changes needed.")
        return 0

    backup = LIBRARY_PATH.with_suffix(".json.bak")
    shutil.copy2(LIBRARY_PATH, backup)
    print(f"Backup: {backup}")

    with open(LIBRARY_PATH, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Patched {patched} standard(s):")
    for line in log:
        print(line)
    print(
        "\nNOTE: This patch is intentionally conservative. Standards that "
        "would need single-system attribution or domain-specific judgment "
        "are left alone for Robo's review pass."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
