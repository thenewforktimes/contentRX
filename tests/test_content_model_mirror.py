"""Pin the public `content-model/` spec artifacts to the canonical
sources in `src/content_checker/standards/`.

BUILD_PLAN_v2 Session 20 preparation. The plan is to extract
`content-model/` to its own public repo
(`github.com/contentrx/content-model`) and have the engine consume a
pinned version. Until that happens, the two copies must stay in
lockstep — otherwise the public spec drifts silently away from what
the engine is actually enforcing. This test fails the build if they
do.

When you intentionally change the standards library or moments
taxonomy, update BOTH locations in the same PR.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
CANONICAL_DIR = REPO_ROOT / "src" / "content_checker" / "standards"
PUBLIC_DIR = REPO_ROOT / "content-model"


@pytest.mark.parametrize(
    "filename",
    ["standards_library.json", "moments_taxonomy.json"],
)
def test_content_model_mirror_matches_canonical(filename: str) -> None:
    canonical_path = CANONICAL_DIR / filename
    public_path = PUBLIC_DIR / filename
    assert canonical_path.exists(), (
        f"Canonical source missing at {canonical_path}"
    )
    assert public_path.exists(), (
        f"Public mirror missing at {public_path}. Update both when "
        "the taxonomy changes."
    )

    canonical = json.loads(canonical_path.read_text(encoding="utf-8"))
    public = json.loads(public_path.read_text(encoding="utf-8"))

    # Compare the parsed JSON rather than raw bytes so formatting
    # differences (trailing newlines, indent) don't fail the test.
    # The cost is that semantically-identical but structurally-
    # different files would pass; worth it.
    assert canonical == public, (
        f"content-model/{filename} has drifted from "
        f"src/content_checker/standards/{filename}. Re-sync with:\n"
        f"  cp src/content_checker/standards/{filename} content-model/{filename}"
    )
