"""Tests for tools/case_study_candidates.py.

Human-eval build plan Sessions 26–28 (scaffolding). Pins the scoring
math + the deterministic-output invariant so the committed
`evals/case_study_candidates.json` doesn't churn between identical
runs.
"""

from __future__ import annotations

import json
from pathlib import Path

from tools.case_study_candidates import (
    DEFAULT_LICENSE_WEIGHT,
    LICENSE_WEIGHT,
    rank,
    render_output,
    score_repo,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def _repo(
    *,
    owner: str = "example",
    name: str = "repo",
    license: str = "MIT",
    has_content_designer: bool = False,
    active_i18n: bool = False,
    content_design_blog: bool = False,
    reason: str = "",
) -> dict:
    return {
        "owner": owner,
        "name": name,
        "license": license,
        "reason": reason,
        "quality_signals": {
            "has_content_designer": has_content_designer,
            "active_i18n": active_i18n,
            "content_design_blog": content_design_blog,
        },
    }


def test_score_repo_max_score_with_all_signals_and_permissive_license():
    c = score_repo(
        _repo(
            has_content_designer=True,
            active_i18n=True,
            content_design_blog=True,
            license="MIT",
        )
    )
    assert c.score == 1.0


def test_score_repo_zero_when_no_signals():
    c = score_repo(
        _repo(
            has_content_designer=False,
            active_i18n=False,
            content_design_blog=False,
            license="MIT",
        )
    )
    assert c.score == 0.0


def test_score_repo_respects_license_weight_differences():
    permissive = score_repo(
        _repo(has_content_designer=True, active_i18n=True, license="MIT")
    )
    restrictive = score_repo(
        _repo(has_content_designer=True, active_i18n=True, license="BUSL-1.1")
    )
    assert permissive.score > restrictive.score


def test_score_repo_unknown_license_falls_back_to_default_weight():
    c = score_repo(
        _repo(
            has_content_designer=True,
            active_i18n=True,
            content_design_blog=True,
            license="SomeNovelLicense-1.0",
        )
    )
    # Known-best is 1.0 (MIT + 3 signals). Unknown license rides the
    # default weight, so the score must be ≤ 1.0 and > 0.
    assert 0.0 < c.score <= 1.0
    # Specifically, sqrt(1.0 * 0.5) == ~0.707.
    assert abs(c.score - 0.7071) < 0.001


def test_rank_returns_topn_and_is_stable_on_ties():
    repos = [
        _repo(owner="vercel", name="next.js", has_content_designer=True,
              active_i18n=True, content_design_blog=True, license="MIT"),
        _repo(owner="supabase", name="supabase", has_content_designer=True,
              active_i18n=True, content_design_blog=True, license="Apache-2.0"),
        _repo(owner="tailwindlabs", name="headlessui", license="MIT"),
    ]
    allow = {"repos": repos}
    top = rank(allow, top=2)
    # Two 1.0-scoring tied; alphabetical tiebreak puts supabase first.
    assert [c.name for c in top] == ["supabase", "next.js"]


def test_rank_is_deterministic_across_runs():
    repos = [
        _repo(owner="alpha", name="a", has_content_designer=True, license="MIT"),
        _repo(owner="beta", name="b", has_content_designer=True, license="MIT"),
        _repo(owner="gamma", name="c", license="Apache-2.0"),
    ]
    allow = {"repos": repos}
    out_1 = [(c.owner, c.name, c.score) for c in rank(allow, top=3)]
    out_2 = [(c.owner, c.name, c.score) for c in rank(allow, top=3)]
    assert out_1 == out_2


def test_render_output_structure_locks_public_fields():
    repos = [
        _repo(owner="vercel", name="next.js", has_content_designer=True,
              active_i18n=True, content_design_blog=True, license="MIT"),
    ]
    top = rank({"repos": repos}, top=1)
    payload = render_output(
        top,
        generated_at="2026-04-24T00:00:00Z",
        source_path="external_signal/allow_list.json",
    )
    assert payload["schema_version"] == "1.0.0"
    assert payload["generated_at"] == "2026-04-24T00:00:00Z"
    entry = payload["top"][0]
    # Public fields on the shortlist card.
    for key in (
        "owner",
        "name",
        "license",
        "reason",
        "score",
        "quality_signals",
    ):
        assert key in entry, f"missing `{key}` on rendered entry"


def test_license_weight_table_includes_all_licenses_in_allow_list():
    """Every license we're actually likely to see in allow_list.json
    should have an explicit weight so the default-fallback isn't
    silently used for common licenses.
    """
    path = REPO_ROOT / "external_signal" / "allow_list.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    missing: list[str] = []
    for repo in raw["repos"]:
        lic = repo.get("license")
        if lic and lic not in LICENSE_WEIGHT:
            missing.append(lic)
    assert not missing, (
        f"These licenses appear in allow_list.json but not in LICENSE_WEIGHT: "
        f"{sorted(set(missing))}. Add explicit weights or document the fallback."
    )


def test_committed_shortlist_matches_allow_list_at_head():
    """Protects against `evals/case_study_candidates.json` drifting
    from the allow_list.json it was generated from.
    """
    committed_path = REPO_ROOT / "evals" / "case_study_candidates.json"
    allow_path = REPO_ROOT / "external_signal" / "allow_list.json"
    if not committed_path.exists():
        # Scaffolding may not have shipped the committed shortlist yet;
        # skip cleanly rather than fail the suite.
        return
    committed = json.loads(committed_path.read_text(encoding="utf-8"))
    allow = json.loads(allow_path.read_text(encoding="utf-8"))
    expected = rank(allow, top=len(committed["top"]))
    assert [
        (c.owner, c.name) for c in expected
    ] == [(e["owner"], e["name"]) for e in committed["top"]], (
        "evals/case_study_candidates.json is stale relative to "
        "external_signal/allow_list.json. Re-run "
        "`python3 tools/case_study_candidates.py` and commit."
    )
