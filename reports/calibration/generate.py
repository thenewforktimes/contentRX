"""Weekly calibration log generator.

Phase C2 of the post-pivot rolling plan. Produces one markdown file
per ISO week — `reports/calibration/YYYY-WW.md` — by reading
file-based substrate and emitting a templated narrative. Cron-driven
invocation (Monday 14:00 UTC) lands in C4 alongside the staleness
monitor + email alerting; this PR ships the pure generator + the
file shape.

Inputs (file-only — no DB access in C2):

  - reports/accuracy/latest.json (this week's snapshot, written by
    the C1 nightly accuracy generator)
  - reports/accuracy/<YYYY-WW>.json (prior-week snapshot, optional;
    if missing the κ-delta line shows a sentinel)
  - taxonomy_refinement_log.md (active refinement candidates)
  - evals/drift/reports/*.json (drift signals; newest by mtime)

Override-by-subtype rollups are deferred to a later session — they
need DB access and will land via a substrate API endpoint in C4 or
its own PR.

Output schema is templated for consistency-of-format across weeks,
because that is what makes drift-in-the-writing detectable. The
narrative tone is intentionally machine-flat.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path

GENERATOR_VERSION = "1.0.0"


@dataclass
class CalibrationLog:
    """Structured intermediate representation. The CLI renders this
    as markdown; tests inspect the dict directly."""

    week: str  # ISO week as "YYYY-WW"
    generated_at: str
    measured_system: dict | None
    prior_measured_system: dict | None
    kappa_delta_pp: float | None  # week-over-week percentage-point delta
    drift_status: str
    by_level: dict
    standards_measured: int
    standards_total: int
    active_refinements_count: int
    active_refinements_top3: list[str]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate the weekly calibration log."
    )
    parser.add_argument(
        "--accuracy",
        type=Path,
        default=Path("reports/accuracy/latest.json"),
    )
    parser.add_argument(
        "--prior-accuracy",
        type=Path,
        help="Optional prior-week snapshot for the κ delta line.",
    )
    parser.add_argument(
        "--refinement-log",
        type=Path,
        default=Path("taxonomy_refinement_log.md"),
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("reports/calibration"),
    )
    parser.add_argument(
        "--week",
        type=str,
        help='Override ISO week (e.g. "2026-17"). Defaults to current.',
    )
    args = parser.parse_args(argv)

    now = datetime.now(timezone.utc)
    week = args.week or iso_week(now)

    accuracy = _safe_read_json(args.accuracy)
    prior = _safe_read_json(args.prior_accuracy) if args.prior_accuracy else None
    refinement_md = _safe_read_text(args.refinement_log) or ""

    log = build_calibration_log(
        accuracy=accuracy,
        prior_accuracy=prior,
        refinement_log_md=refinement_md,
        week=week,
        now=now,
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / f"{week}.md"
    out_path.write_text(render_markdown(log), encoding="utf-8")
    print(f"wrote {out_path}", file=sys.stderr)
    return 0


def build_calibration_log(
    *,
    accuracy: dict | None,
    prior_accuracy: dict | None,
    refinement_log_md: str,
    week: str,
    now: datetime,
) -> CalibrationLog:
    """Pure builder. Tests exercise this directly with structured inputs."""
    measured_system = _safe_kappa(accuracy)
    prior_measured = _safe_kappa(prior_accuracy)
    kappa_delta_pp = _kappa_delta_pp(measured_system, prior_measured)

    drift_status = _drift_status(accuracy)

    by_level = {"robo_labels": 0, "batch_approval": 0, "autonomous": 0}
    standards_measured = 0
    standards_total = 47
    if accuracy and isinstance(accuracy.get("by_level"), dict):
        for k in by_level.keys():
            v = accuracy["by_level"].get(k, 0)
            by_level[k] = int(v) if isinstance(v, (int, float)) else 0
    if accuracy:
        standards_measured = int(accuracy.get("standards_measured", 0) or 0)
        if isinstance(accuracy.get("standards_total"), int):
            standards_total = int(accuracy["standards_total"])

    refinements = _active_refinements(refinement_log_md)

    return CalibrationLog(
        week=week,
        generated_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        measured_system=measured_system,
        prior_measured_system=prior_measured,
        kappa_delta_pp=kappa_delta_pp,
        drift_status=drift_status,
        by_level=by_level,
        standards_measured=standards_measured,
        standards_total=standards_total,
        active_refinements_count=len(refinements),
        active_refinements_top3=[r.strip() for r in refinements[:3]],
    )


def render_markdown(log: CalibrationLog) -> str:
    lines: list[str] = []

    lines.append(f"# Calibration log — {log.week}")
    lines.append("")
    lines.append(f"_Generated {log.generated_at}._")
    lines.append("")

    # Section 1: Headline κ
    lines.append("## Measured system κ")
    lines.append("")
    if log.measured_system:
        v = log.measured_system["value"]
        lo = log.measured_system["ci_low"]
        hi = log.measured_system["ci_high"]
        n = log.measured_system.get("sample_size", 0)
        lines.append(
            f"- κ = **{v:.3f}** (95% CI [{lo:.3f}, {hi:.3f}], n = {n})."
        )
        if log.kappa_delta_pp is not None:
            sign = "+" if log.kappa_delta_pp >= 0 else ""
            lines.append(
                f"- Week-over-week delta: {sign}{log.kappa_delta_pp:.1f} percentage points."
            )
        else:
            lines.append("- Week-over-week delta: no prior-week snapshot to compare against.")
    else:
        lines.append("- _Pending — no accuracy snapshot available this week._")
    lines.append("")

    # Section 2: Drift status
    lines.append("## Drift")
    lines.append("")
    lines.append(f"- {log.drift_status}")
    lines.append("")

    # Section 3: Coverage
    lines.append("## Coverage")
    lines.append("")
    lines.append(
        f"- Standards measured: **{log.standards_measured}** of {log.standards_total}."
    )
    lines.append(
        f"- By graduation level: {log.by_level['autonomous']} autonomous, "
        f"{log.by_level['batch_approval']} batch_approval, "
        f"{log.by_level['robo_labels']} robo_labels."
    )
    lines.append("")

    # Section 4: Active refinements
    lines.append("## Active refinements")
    lines.append("")
    if log.active_refinements_count == 0:
        lines.append("- No open candidates this week.")
    else:
        lines.append(
            f"- Open: **{log.active_refinements_count}**. Top three by recency:"
        )
        for r in log.active_refinements_top3:
            lines.append(f"  - {r}")
    lines.append("")

    # Section 5: Override stream. Customer-facing pending phrasing —
    # the prior copy mentioned "substrate API" and pointed at
    # /admin/queue, both of which are internal-only references that
    # leaked onto the public weekly log. ADR 2026-04-25 (private
    # taxonomy) and docs/copy-vocabulary.md both reserve those terms
    # for internal surfaces; the public log gets a plain pending line.
    lines.append("## Override stream")
    lines.append("")
    lines.append(
        "- No override data this week. Override counts and the "
        "common-disagreement breakdown will appear here once the "
        "weekly rollup pipeline lands."
    )
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def iso_week(now: datetime) -> str:
    iso = now.date().isocalendar()
    return f"{iso[0]}-{iso[1]:02d}"


def _safe_read_json(path: Path | None) -> dict | None:
    if path is None:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _safe_read_text(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError):
        return None


def _safe_kappa(snapshot: dict | None) -> dict | None:
    if not snapshot:
        return None
    measured = snapshot.get("measured_system")
    if not isinstance(measured, dict):
        return None
    if measured.get("state") != "measured":
        return None
    if not isinstance(measured.get("value"), (int, float)):
        return None
    return {
        "value": float(measured["value"]),
        "ci_low": float(measured.get("ci_low", measured["value"])),
        "ci_high": float(measured.get("ci_high", measured["value"])),
        "sample_size": int(measured.get("sample_size", 0)),
    }


def _kappa_delta_pp(
    current: dict | None, prior: dict | None
) -> float | None:
    """Return week-over-week κ delta in percentage points, or None
    when either side is unmeasured."""
    if not current or not prior:
        return None
    return round((current["value"] - prior["value"]) * 100, 1)


def _drift_status(snapshot: dict | None) -> str:
    if not snapshot:
        return "Drift status: no snapshot available."
    sd = snapshot.get("measured_self_drift")
    if not isinstance(sd, dict):
        return "Drift status: no self-drift signal in the snapshot."
    if sd.get("state") == "measured":
        v = sd.get("value")
        return f"Self-drift κ = {v:.3f} (Robert vs past-Robert on the held-out panel)."
    reason = sd.get("reason", "pending")
    return f"Self-drift status: pending — {reason}."


# Refinement-log parser — reuses the same shape as
# src/lib/admin-refinement-log-parser.ts but in Python. We don't
# import that module because it's TS; the parsing logic is small
# enough to mirror.

import re

_STATUS_HEADER_TO_KEY = {
    "## Open refinements": "open",
    "## Proposed refinements": "auto_detected",
    "## Approved refinements": "approved",
    "## Declined refinements": "declined",
}
_REF_ID_RE = re.compile(r"^### (REF-A?\d+)(?::?\s*(.*))?$")


def _active_refinements(md: str) -> list[str]:
    """Return a list of "REF-XXX: title" strings for the open +
    auto_detected sections, in document order."""
    if not md:
        return []
    lines = md.split("\n")
    section_status: str | None = None
    out: list[str] = []
    for line in lines:
        if line.startswith("## "):
            matched = None
            for marker, key in _STATUS_HEADER_TO_KEY.items():
                if line.startswith(marker):
                    matched = key
                    break
            section_status = matched
            continue
        if section_status not in ("open", "auto_detected"):
            continue
        m = _REF_ID_RE.match(line)
        if m:
            ref_id = m.group(1)
            title = (m.group(2) or "").strip()
            label = f"{ref_id}: {title}" if title else ref_id
            out.append(label)
    return out


if __name__ == "__main__":
    raise SystemExit(main())
