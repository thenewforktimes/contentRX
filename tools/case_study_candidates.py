"""Score + rank case-study candidate projects.

Human-eval build plan Sessions 26–28 (the "careful" half). The plan
requires three OSS case studies; maintainer contact + live API runs
are on Robo's side, but candidate selection can be deterministic.

This tool reads `external_signal/allow_list.json` and scores every
entry by quality signals (content-designer acknowledged, active
i18n, content-design blog) and license permissiveness. It writes a
committed artefact at `evals/case_study_candidates.json` that the
`/case-studies` index renders publicly — surfacing the shortlist is
part of the transparency commitment: anyone can see which projects
are under consideration and object before outreach starts.

Usage:
    python3 tools/case_study_candidates.py
    python3 tools/case_study_candidates.py --top 5 --output /tmp/candidates.json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "evals" / "case_study_candidates.json"
ALLOW_LIST = REPO_ROOT / "external_signal" / "allow_list.json"


# License permissiveness weight — permissive (MIT, Apache) scores
# higher than copyleft (AGPL) or unlicensed because the post is more
# likely to survive maintainer review when the content is already
# under a quote-friendly license. These weights don't DISQUALIFY any
# project; maintainer approval is the hard gate regardless.
LICENSE_WEIGHT: dict[str, float] = {
    "MIT": 1.0,
    "Apache-2.0": 1.0,
    "BSD-2-Clause": 1.0,
    "BSD-3-Clause": 1.0,
    "CC0-1.0": 1.0,
    "CC-BY-4.0": 0.9,
    "CC-BY-SA-2.5": 0.7,
    "AGPL-3.0": 0.6,
    "GPL-3.0": 0.6,
    "BUSL-1.1": 0.5,
}
DEFAULT_LICENSE_WEIGHT = 0.5


@dataclass(frozen=True)
class Candidate:
    owner: str
    name: str
    license: str
    reason: str
    score: float
    quality_signals: dict[str, bool]


def score_repo(repo: dict[str, Any]) -> Candidate:
    signals = repo.get("quality_signals") or {}
    signal_count = sum(
        1
        for k in ("has_content_designer", "active_i18n", "content_design_blog")
        if signals.get(k)
    )
    # Three signals → 1.0; two → 0.67; one → 0.33; none → 0.
    signal_weight = signal_count / 3.0
    license_id = repo.get("license", "")
    license_weight = LICENSE_WEIGHT.get(license_id, DEFAULT_LICENSE_WEIGHT)
    # Geometric mean so a repo with 3 signals + a low-license-weight
    # still scores credibly but not max. Keeps any single dimension
    # from dominating the ranking.
    score = round((signal_weight * license_weight) ** 0.5, 4)
    return Candidate(
        owner=repo["owner"],
        name=repo["name"],
        license=license_id,
        reason=repo.get("reason", ""),
        score=score,
        quality_signals={
            "has_content_designer": bool(signals.get("has_content_designer")),
            "active_i18n": bool(signals.get("active_i18n")),
            "content_design_blog": bool(signals.get("content_design_blog")),
        },
    )


def rank(
    allow_list: dict[str, Any],
    *,
    top: int,
) -> list[Candidate]:
    repos = allow_list.get("repos") or []
    scored = [score_repo(r) for r in repos]
    # Sort: score desc, then license weight desc, then owner/name for
    # a stable tiebreak so the output is deterministic.
    scored.sort(
        key=lambda c: (
            -c.score,
            -LICENSE_WEIGHT.get(c.license, DEFAULT_LICENSE_WEIGHT),
            c.owner.lower(),
            c.name.lower(),
        )
    )
    return scored[:top]


def render_output(
    top: list[Candidate],
    *,
    generated_at: str,
    source_path: str,
) -> dict[str, Any]:
    return {
        "schema_version": "1.0.0",
        "generated_at": generated_at,
        "source": source_path,
        "top": [
            {
                "owner": c.owner,
                "name": c.name,
                "license": c.license,
                "reason": c.reason,
                "score": c.score,
                "quality_signals": c.quality_signals,
            }
            for c in top
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allow-list",
        type=Path,
        default=ALLOW_LIST,
        help="Path to external_signal/allow_list.json.",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=5,
        help="Number of top candidates to surface (default: 5).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Where to write the JSON output.",
    )
    parser.add_argument(
        "--now",
        default=None,
        help="Override the `generated_at` timestamp (for deterministic tests).",
    )
    args = parser.parse_args()

    allow_list = json.loads(args.allow_list.read_text(encoding="utf-8"))
    top = rank(allow_list, top=args.top)
    now = args.now or datetime.now(timezone.utc).isoformat()
    payload = render_output(
        top,
        generated_at=now,
        source_path=str(args.allow_list.relative_to(REPO_ROOT))
        if args.allow_list.is_absolute()
        else str(args.allow_list),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {len(top)} candidate(s) to {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())


__all__ = [
    "Candidate",
    "DEFAULT_LICENSE_WEIGHT",
    "LICENSE_WEIGHT",
    "rank",
    "render_output",
    "score_repo",
]
