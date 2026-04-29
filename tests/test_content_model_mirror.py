"""Regression guard: the public `content-model/` directory must not
contain the substrate JSON files.

Per ADR 2026-04-25 (private-taxonomy pivot), the taxonomy is private.
The `content-model/` directory was prepared to be a public CC BY 4.0
spec repo and was considered against; the substrate JSON files were
moved to private storage on 2026-04-29 (see CHANGELOG, "Repo —
public-surface scope" entry).

This test exists to catch a future regression: anyone re-introducing
the public mirror (intentionally or by accident) should land here and
read the ADR before deciding the position has changed.

When the position is reconsidered, the path is a new ADR superseding
the 2026-04-25 pivot — not flipping these assertions in a routine PR.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "content-model"


@pytest.mark.parametrize(
    "filename",
    ["standards_library.json", "moments_taxonomy.json", "SPEC.md"],
)
def test_content_model_substrate_not_publicly_mirrored(filename: str) -> None:
    public_path = PUBLIC_DIR / filename
    assert not public_path.exists(), (
        f"Substrate file {public_path} reappeared in the public tree. "
        "ADR 2026-04-25 says the taxonomy is private — read "
        "decisions/2026-04-25-private-taxonomy-pivot.md before deciding "
        "this is intentional. If the position has actually changed, "
        "delete this test and write a new ADR superseding the pivot."
    )
