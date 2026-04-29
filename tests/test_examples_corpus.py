"""Tests for the Session 16 examples corpus + disagreement map.

Schema integrity only — the corpus content is reviewed human-side;
these tests catch structural drift (missing fields, unknown standard
IDs, sources that don't match the canonical list).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
PAIRS_PATH = REPO_ROOT / "evals" / "examples_corpus" / "pairs.json"
DISAGREEMENTS_PATH = (
    REPO_ROOT / "evals" / "examples_corpus" / "disagreement_map.json"
)
LIBRARY_PATH = (
    REPO_ROOT / "src" / "content_checker" / "standards" / "private" / "standards_library.json"
)

# Known preprocessor-only standards that live in preprocess.py, not the
# library. They're still legitimate standard IDs used by the corpus.
PREPROCESSOR_ONLY_STANDARDS = {
    "PRF-01", "PRF-03", "PRF-09", "PRF-11",
}


def _load(p: Path) -> dict:
    with open(p) as f:
        return json.load(f)


def _library_standard_ids() -> set[str]:
    data = _load(LIBRARY_PATH)
    out = set()
    for cat in data.get("categories", []):
        for std in cat.get("standards", []):
            if std.get("id"):
                out.add(std["id"])
    return out


# ---------------------------------------------------------------------------
# pairs.json
# ---------------------------------------------------------------------------


class TestPairsSchema:
    def test_file_exists_and_parses(self):
        assert PAIRS_PATH.exists()
        data = _load(PAIRS_PATH)
        assert isinstance(data, dict)

    def test_schema_version_set(self):
        data = _load(PAIRS_PATH)
        assert data.get("schema_version") == "1.0.0"

    def test_has_pairs_list(self):
        data = _load(PAIRS_PATH)
        assert isinstance(data.get("pairs"), list)

    def test_every_pair_has_required_fields(self):
        data = _load(PAIRS_PATH)
        required = {
            "pair_id", "standard_id", "source_system",
            "not_this", "but_this", "license",
        }
        for pair in data["pairs"]:
            missing = required - set(pair.keys())
            assert not missing, (
                f"Pair {pair.get('pair_id')} missing fields: {missing}"
            )

    def test_pair_ids_are_unique(self):
        data = _load(PAIRS_PATH)
        ids = [p["pair_id"] for p in data["pairs"]]
        assert len(ids) == len(set(ids)), "duplicate pair_id"

    def test_standard_ids_exist_in_library_or_preprocessor(self):
        library_ids = _library_standard_ids()
        allowed = library_ids | PREPROCESSOR_ONLY_STANDARDS
        data = _load(PAIRS_PATH)
        for pair in data["pairs"]:
            sid = pair.get("standard_id")
            assert sid in allowed, (
                f"Pair {pair['pair_id']} references unknown standard {sid}"
            )

    def test_source_system_uses_canonical_name(self):
        # Prevents drift into abbreviations ("mc" vs "Mailchimp").
        canonical = {
            "Mailchimp",
            "GOV.UK Style Guide",
            "18F Content Guide",
            "Google Developer Documentation Style Guide",
            "Microsoft Writing Style Guide",
            "Atlassian Design System",
            "Shopify Polaris",
            "IBM Carbon",
            "Apple HIG",
            "Salesforce Lightning Writing",
            "GitHub Primer",
            "USWDS",
            "Intuit Content Design Principles",
            "Material Design",
            "Chicago Manual of Style",
        }
        data = _load(PAIRS_PATH)
        for pair in data["pairs"]:
            source = pair.get("source_system")
            assert source in canonical, (
                f"Pair {pair['pair_id']} uses non-canonical source "
                f"{source!r} — add to the canonical list in the test if new."
            )

    def test_not_this_and_but_this_differ(self):
        data = _load(PAIRS_PATH)
        for pair in data["pairs"]:
            assert pair["not_this"] != pair["but_this"] or (
                # Rare exception: pair explicitly demonstrates suppression
                # (same text is both "not_this" and "but_this" by context).
                "suppress" in pair.get("rationale", "").lower()
            ), f"Pair {pair['pair_id']} has identical not_this/but_this"

    def test_has_at_least_thirty_pairs(self):
        # Session 16 success criterion aims for 50; this PR ships 30+ as
        # an initial seed. Future sessions grow the corpus.
        data = _load(PAIRS_PATH)
        assert len(data["pairs"]) >= 30


# ---------------------------------------------------------------------------
# disagreement_map.json
# ---------------------------------------------------------------------------


class TestDisagreementMap:
    def test_file_exists_and_parses(self):
        assert DISAGREEMENTS_PATH.exists()
        data = _load(DISAGREEMENTS_PATH)
        assert isinstance(data, dict)

    def test_has_entries(self):
        data = _load(DISAGREEMENTS_PATH)
        entries = data.get("entries", [])
        assert isinstance(entries, list)
        assert len(entries) >= 3

    def test_every_entry_has_required_fields(self):
        data = _load(DISAGREEMENTS_PATH)
        required = {
            "disagreement_id", "topic", "positions", "contentrx_resolution",
        }
        for entry in data["entries"]:
            missing = required - set(entry.keys())
            assert not missing, (
                f"Entry {entry.get('disagreement_id')} missing {missing}"
            )

    def test_positions_have_source_and_position(self):
        data = _load(DISAGREEMENTS_PATH)
        for entry in data["entries"]:
            positions = entry.get("positions", [])
            assert len(positions) >= 2, (
                f"{entry['disagreement_id']} needs ≥2 positions to qualify "
                "as a disagreement"
            )
            for p in positions:
                assert p.get("source_system")
                assert p.get("position")

    def test_related_standards_are_known(self):
        library_ids = _library_standard_ids()
        allowed = library_ids | PREPROCESSOR_ONLY_STANDARDS
        data = _load(DISAGREEMENTS_PATH)
        for entry in data["entries"]:
            for sid in entry.get("related_standards", []):
                assert sid in allowed, (
                    f"{entry['disagreement_id']} references unknown "
                    f"standard {sid}"
                )

    def test_disagreement_ids_are_unique(self):
        data = _load(DISAGREEMENTS_PATH)
        ids = [e["disagreement_id"] for e in data["entries"]]
        assert len(ids) == len(set(ids))


# ---------------------------------------------------------------------------
# Sources attribution on standards
# ---------------------------------------------------------------------------


class TestSourcesAttribution:
    def test_at_least_thirty_standards_have_sources(self):
        """Session 16 extension — was 17/47; we added ~13 more."""
        data = _load(LIBRARY_PATH)
        with_sources = 0
        for cat in data["categories"]:
            for std in cat["standards"]:
                if std.get("sources"):
                    with_sources += 1
        assert with_sources >= 30, f"Only {with_sources} standards have sources"

    def test_sources_are_string_lists(self):
        data = _load(LIBRARY_PATH)
        for cat in data["categories"]:
            for std in cat["standards"]:
                sources = std.get("sources")
                if sources is None:
                    continue
                assert isinstance(sources, list), std["id"]
                assert all(isinstance(s, str) for s in sources), std["id"]
