"""Pin src/lib/engine-taxonomy.ts against the Python engine sources.

The TS file hand-mirrors three Python lists so /api/check (and every
other text-accepting route) can zod-validate incoming request fields
against the same vocabulary the Python engine accepts:

  CONTENT_TYPES → content_checker/standards/private/standards_library.json
                  :: content_types[].id
  MOMENTS       → content_checker/moments.py :: MOMENT_TAXONOMY (keys)
  AUDIENCES     → content_checker/audience.py :: Audience (values)

Drift between TS and Python here is what bit us before this gate
existed: PR #338 added the `native_mobile` audience to Python with
dedicated ACC-08 logic, but the TS list was never updated. /api/check
would have rejected `audience: "native_mobile"` with a 400, so the
engine feature was completely unreachable through every product
surface. This test fails fast on that class of drift.

The regex below is intentionally narrow. If we later reformat the TS
file the parser gets a rewrite; the locked acceptance criterion is
"the sets match," not "the file looks a specific way."
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from content_checker.audience import Audience
from content_checker.moments import MOMENT_TAXONOMY

REPO_ROOT = Path(__file__).resolve().parent.parent
TS_FILE = REPO_ROOT / "src" / "lib" / "engine-taxonomy.ts"
STANDARDS_LIBRARY = (
    REPO_ROOT
    / "src"
    / "content_checker"
    / "standards"
    / "private"
    / "standards_library.json"
)

# Matches entries like:  "button_cta",
_ENTRY_RE = re.compile(r"\"(?P<value>[a-z_]+)\"")


def _parse_const_set(const_name: str) -> set[str]:
    """Extract values from `export const NAME = [...] as const;` in the TS source.

    Scopes the regex to the contents of the named const so unrelated
    strings in the file can't spoof entries.
    """
    source = TS_FILE.read_text(encoding="utf-8")
    start = source.index(f"export const {const_name}")
    end = source.index("] as const;", start)
    block = source[start:end]
    return {m.group("value") for m in _ENTRY_RE.finditer(block)}


def _python_content_types() -> set[str]:
    """Read content_types[].id from the canonical standards library JSON."""
    data = json.loads(STANDARDS_LIBRARY.read_text(encoding="utf-8"))
    return {ct["id"] for ct in data.get("content_types", [])}


class TestEngineTaxonomyMirror:
    def test_content_types_match_standards_library(self) -> None:
        ts = _parse_const_set("CONTENT_TYPES")
        py = _python_content_types()
        assert ts == py, (
            f"src/lib/engine-taxonomy.ts CONTENT_TYPES drifted from "
            f"src/content_checker/standards/private/standards_library.json "
            f"content_types[].id.\n"
            f"  TS has but Python doesn't: {sorted(ts - py)}\n"
            f"  Python has but TS doesn't: {sorted(py - ts)}\n"
            f"  Fix: edit the TS file to match and re-run the test."
        )

    def test_moments_match_moment_taxonomy(self) -> None:
        ts = _parse_const_set("MOMENTS")
        py = set(MOMENT_TAXONOMY.keys())
        assert ts == py, (
            f"src/lib/engine-taxonomy.ts MOMENTS drifted from "
            f"src/content_checker/moments.py :: MOMENT_TAXONOMY.\n"
            f"  TS has but Python doesn't: {sorted(ts - py)}\n"
            f"  Python has but TS doesn't: {sorted(py - ts)}\n"
            f"  Fix: edit the TS file to match and re-run the test."
        )

    def test_audiences_match_audience_enum(self) -> None:
        ts = _parse_const_set("AUDIENCES")
        py = {a.value for a in Audience}
        assert ts == py, (
            f"src/lib/engine-taxonomy.ts AUDIENCES drifted from "
            f"src/content_checker/audience.py :: Audience enum.\n"
            f"  TS has but Python doesn't: {sorted(ts - py)}\n"
            f"  Python has but TS doesn't: {sorted(py - ts)}\n"
            f"  Fix: edit the TS file to match and re-run the test. "
            f"This is the exact gap that hid `native_mobile` from every "
            f"product surface for the entire beta-prep window before the "
            f"gate landed — re-introducing it would land the same bug."
        )
