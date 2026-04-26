#!/usr/bin/env python3
"""Daily staleness watchdog over the report tree.

Phase C4 of the post-pivot rolling plan. Runs from
`.github/workflows/reports_staleness.yml`. Mirrors the staleness
logic in `src/lib/admin-reports.server.ts` so the founder-side
`/admin/reports` page and the cron-side watchdog flag the same
files.

Per-type thresholds (in days; anything older than the threshold is
stale):

    accuracy:    2    (nightly cadence + 1 day grace)
    calibration: 8    (Monday weekly cadence + 1 day grace)
    quarterly:   95   (first-Monday-of-quarter + slack)

Exits non-zero when at least one subdirectory contains no fresh
file. A non-zero exit fails the workflow, which routes a
notification to repo watchers via GitHub's standard email path.

The architecture doc's reasoning: "stale reports are worse than no
reports for the named-expert moat — the moat depends on continuity
of evidence."
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

REPORTS_ROOT = Path("reports")

THRESHOLDS_DAYS: dict[str, int] = {
    "accuracy": 2,
    "calibration": 8,
    "quarterly": 95,
}

DAY_SECONDS = 86_400


def main() -> int:
    if not REPORTS_ROOT.is_dir():
        print(
            f"::error ::reports/ directory missing — generator scaffold not in place",
            file=sys.stderr,
        )
        return 2

    now = time.time()
    failures: list[str] = []

    for subdir, threshold_days in THRESHOLDS_DAYS.items():
        path = REPORTS_ROOT / subdir
        if not path.is_dir():
            failures.append(
                f"{path}: subdirectory missing"
            )
            continue
        files = [f for f in path.iterdir() if f.is_file() and not f.name.startswith(".")]
        if not files:
            failures.append(
                f"{path}: no generator output yet (Phase C generators "
                "haven't run, or the staleness monitor is configured "
                "before the first generation)"
            )
            continue
        newest = max(files, key=lambda f: f.stat().st_mtime)
        age_seconds = now - newest.stat().st_mtime
        age_days = age_seconds / DAY_SECONDS
        if age_days > threshold_days:
            failures.append(
                f"{path}: newest file {newest.name} is {age_days:.1f} days old "
                f"(threshold {threshold_days}d)"
            )
        else:
            print(
                f"::notice ::{path} fresh — {newest.name} is {age_days:.1f} days old"
            )

    if failures:
        for line in failures:
            print(f"::error ::{line}", file=sys.stderr)
        print(
            "::error ::Reports staleness check failed. "
            "Stale reports are worse than no reports for the "
            "named-expert moat — investigate before the next public "
            "deploy.",
            file=sys.stderr,
        )
        return 1
    print("::notice ::All report subdirectories are within their staleness thresholds.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
