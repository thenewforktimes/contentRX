"""Pin src/lib/moment-metadata.ts against moments.py :: MOMENT_TAXONOMY.

Human-eval build plan Session 22. The TypeScript side hand-mirrors the
13 moment descriptions so client components can render the moment
banner without a round-trip to the Python engine. This test makes sure
the hand-mirror stays in sync — edit moments.py without touching the
TS file and the test fails, surfacing the drift before a deploy.

The regex below is intentionally narrow. If we later reformat the TS
file (say, one-line entries become multi-line), we rewrite the parser;
the locked acceptance criterion is "descriptions match," not "the file
looks a specific way."
"""

from __future__ import annotations

import re
from pathlib import Path

from content_checker.moments import MOMENT_TAXONOMY

REPO_ROOT = Path(__file__).resolve().parent.parent
TS_FILE = REPO_ROOT / "src" / "lib" / "moment-metadata.ts"

# Matches entries like:
#   first_encounter:
#     "Onboarding, setup, first-run. Clarity above all.",
_ENTRY_RE = re.compile(
    r"^\s*(?P<id>[a-z_]+):\s*\n\s*\"(?P<desc>[^\"]*)\",?\s*$",
    re.MULTILINE,
)

# Matches `situation_property` mapping entries like:
#   destructive_action: "destructive",
_SITUATION_RE = re.compile(
    r"^\s*(?P<id>[a-z_]+):\s*\"(?P<prop>[^\"]*)\",?\s*$",
    re.MULTILINE,
)


def _parse_descriptions() -> dict[str, str]:
    """Extract MOMENT_DESCRIPTIONS entries from the TS source file.

    Scopes the regex to the contents of `export const MOMENT_DESCRIPTIONS`
    so unrelated multiline strings in the file can't spoof entries.
    """
    source = TS_FILE.read_text(encoding="utf-8")
    start = source.index("export const MOMENT_DESCRIPTIONS")
    # The block ends at the first `};` after the start.
    end = source.index("\n};", start)
    block = source[start:end]
    return {m.group("id"): m.group("desc") for m in _ENTRY_RE.finditer(block)}


def _parse_situation_properties() -> dict[str, str]:
    source = TS_FILE.read_text(encoding="utf-8")
    start = source.index("export const SITUATION_PROPERTY_BY_MOMENT")
    end = source.index("\n};", start)
    block = source[start:end]
    return {m.group("id"): m.group("prop") for m in _SITUATION_RE.finditer(block)}


def test_ts_descriptions_match_moments_py() -> None:
    ts = _parse_descriptions()
    assert ts == dict(MOMENT_TAXONOMY), (
        "src/lib/moment-metadata.ts MOMENT_DESCRIPTIONS drifted from "
        "src/content_checker/moments.py MOMENT_TAXONOMY. Edit the TS "
        "file to match and re-run the test."
    )


def test_ts_exports_all_thirteen_moments() -> None:
    assert len(_parse_descriptions()) == 13


def test_situation_property_mapping_matches_exporter() -> None:
    """The TS file also pins the three situation-property moments.

    Mirrors `tools/export_moments.py` :: SITUATION_PROPERTY_BY_MOMENT.
    Adding a new situation-flagged moment is a two-file change; this
    test makes sure both files stay coherent.
    """
    assert _parse_situation_properties() == {
        "destructive_action": "destructive",
        "trust_permission": "permission-gated",
        "compliance_disclosure": "compliance",
    }
