#!/usr/bin/env python3
"""Rotation picker for the daily case-study cron.

Reads `external_signal/allow_list.json` (20 curated OSS targets,
each with content_paths already vetted by Session 15 of the
human-eval build plan) and emits a single target's metadata for
the day. Picking is deterministic — `(year * 366 + day_of_year) %
N` — so two runs on the same day always pick the same target,
which lets us safely retry the cron without changing the answer.

Output is plain JSON-one-line on stdout, suitable for piping into
`jq` or reading via $GITHUB_OUTPUT in a GitHub Actions step:

    {"slug": "supabase", "owner": "supabase", "name": "supabase",
     "repo": "https://github.com/supabase/supabase",
     "paths": ["apps/docs/content/**/*.tsx", ...],
     "license": "Apache-2.0"}

The `paths` field is the allow_list's `content_paths` lifted into
`tools/case_study.py crawl --paths` shape — each path is suffixed
with `**/*.tsx` and `**/*.jsx` so the regex extractor finds JSX/TSX
files. Targets that ship docs as `.md` (e.g., mdn/content) get
`**/*.md` appended too.

Usage
-----

    python3 tools/case_study_pick.py
    python3 tools/case_study_pick.py --slug supabase   # explicit override
    python3 tools/case_study_pick.py --date 2026-04-26  # pick for a specific day
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ALLOW_LIST = REPO_ROOT / "external_signal" / "allow_list.json"

# Path-glob suffixes appended to each `content_path` from allow_list.
# We match TSX/JSX (the regex extractor's primary surface) and MD
# (for documentation-first targets like mdn/content).
DEFAULT_GLOB_SUFFIXES = ("**/*.tsx", "**/*.jsx", "**/*.md")


def load_repos() -> list[dict]:
    if not ALLOW_LIST.is_file():
        raise FileNotFoundError(f"missing {ALLOW_LIST}")
    payload = json.loads(ALLOW_LIST.read_text(encoding="utf-8"))
    repos = payload.get("repos") if isinstance(payload, dict) else None
    if not isinstance(repos, list) or len(repos) == 0:
        raise ValueError(f"{ALLOW_LIST} has no `repos` array")
    return repos


def slug_for(repo: dict) -> str:
    """Repo identifier: lowercase owner-name. Drops dots and slashes
    so it round-trips through filesystem paths and URL segments."""
    owner = (repo.get("owner") or "").lower()
    name = (repo.get("name") or "").lower()
    raw = f"{owner}-{name}".replace("/", "-").replace(".", "")
    # Strip non-[A-Za-z0-9_-] characters defensively.
    return "".join(c for c in raw if c.isalnum() or c in "-_")


def rotation_index(date: dt.date, n: int) -> int:
    """Deterministic index in [0, n). Year-of-day-mod-N keeps the
    cycle stable within a year and shifts by 1 each year (366 mod 20
    = 6) so the rotation order doesn't lock onto fixed weekdays."""
    if n <= 0:
        raise ValueError("n must be positive")
    return (date.year * 366 + date.timetuple().tm_yday) % n


def expand_paths(content_paths: list[str]) -> list[str]:
    """Lift `content_paths` from the allow_list (e.g.,
    `["packages/*/src", "packages/*/docs"]`) into glob shapes
    `tools/case_study.py crawl --paths` accepts."""
    out: list[str] = []
    for cp in content_paths:
        cp = cp.rstrip("/")
        for suffix in DEFAULT_GLOB_SUFFIXES:
            out.append(f"{cp}/{suffix}")
    return out


def pick(repos: list[dict], *, slug: str | None, date: dt.date) -> dict:
    if slug is not None:
        for r in repos:
            if slug_for(r) == slug:
                return r
        raise SystemExit(f"slug {slug!r} not found in allow_list")
    return repos[rotation_index(date, len(repos))]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--slug",
        help="Explicit slug override; bypasses the rotation pick",
    )
    parser.add_argument(
        "--date",
        help="ISO date for rotation pick (default: today UTC)",
        default=None,
    )
    args = parser.parse_args()

    if args.date:
        date = dt.date.fromisoformat(args.date)
    else:
        date = dt.datetime.now(dt.timezone.utc).date()

    repos = load_repos()
    repo = pick(repos, slug=args.slug, date=date)

    out = {
        "slug": slug_for(repo),
        "owner": repo.get("owner"),
        "name": repo.get("name"),
        "repo": f"https://github.com/{repo.get('owner')}/{repo.get('name')}",
        "paths": expand_paths(repo.get("content_paths") or []),
        "license": repo.get("license"),
        "reason": repo.get("reason"),
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
