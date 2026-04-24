"""Repo quality scorer — human-eval build plan Session 18.

Scores repos in the allow-list on content-care signals so the review
queue can rank their mined pairs. Higher quality → earlier position
in the queue; lower quality → more filtering.

The plan's signals (paraphrased):

    - Dedicated content-designer or technical-writer acknowledged
      in contributor files (`CONTRIBUTORS.md`, `CODEOWNERS`).
    - Active i18n presence (locales/ or translations/ dir;
      translator pushback documented).
    - Blog posts about content design from the team.

Today's scorer is signal-table-driven: each allow-list entry
optionally carries a `quality_signals` object with booleans for the
three signals above. The scorer sums into a 0-3 score. Future:
auto-fetch these signals from the repo.

Usage:
    from external_signal.repo_quality import score_repo, rank_repos

    score = score_repo(repo)      # repo dict from allow_list.json
    ranking = rank_repos(repos)   # [(repo, score), ...] sorted desc
"""

from __future__ import annotations

from typing import Any


# Signal keys the scorer knows about. Each contributes 1 point when true.
QUALITY_SIGNALS: tuple[str, ...] = (
    "has_content_designer",
    "active_i18n",
    "content_design_blog",
)

MAX_SCORE = len(QUALITY_SIGNALS)


def score_repo(repo: dict[str, Any]) -> dict[str, Any]:
    """Return a score + the signals that fired for one repo.

    Output shape:
        {
            "score": int,           # 0..MAX_SCORE
            "max": int,             # MAX_SCORE
            "signals_fired": [str, …],
            "signals_missing": [str, …],
        }

    When the allow-list entry has no `quality_signals` block, score is
    0 and every signal lands in `signals_missing` — the caller knows
    the repo is unscored, not that it scored zero.
    """
    signals = repo.get("quality_signals") or {}
    fired: list[str] = []
    missing: list[str] = []
    for key in QUALITY_SIGNALS:
        if signals.get(key) is True:
            fired.append(key)
        else:
            missing.append(key)
    return {
        "score": len(fired),
        "max": MAX_SCORE,
        "signals_fired": fired,
        "signals_missing": missing,
    }


def rank_repos(repos: list[dict[str, Any]]) -> list[tuple[dict[str, Any], int]]:
    """Stable-sort repos by descending score; ties break by owner/name."""
    scored = [
        (
            r,
            score_repo(r)["score"],
        )
        for r in repos
    ]
    scored.sort(
        key=lambda rs: (-rs[1], rs[0].get("owner", ""), rs[0].get("name", "")),
    )
    return scored
