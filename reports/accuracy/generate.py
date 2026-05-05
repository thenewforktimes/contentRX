"""Public accuracy snapshot generator.

Phase C1 of the post-pivot rolling plan. Reads substrate (graduation
readiness + drift reports) and emits a public-safe JSON snapshot at
`reports/accuracy/latest.json`. The docs site renders the snapshot;
the founder-side `/admin/calibration` page reads the substrate
directly and shows per-standard breakdowns there.

Privacy contract (per ADR 2026-04-25):

  * The public snapshot exposes ONLY the three load-bearing numbers
    the architecture doc names — measured system κ with 95% CI,
    self-drift κ with 95% CI, and the 0.90 design target stated
    separately. Plus headline counts (`by_level`) so the page can
    show "47 standards measured, N at autonomous tier" without
    naming any standard.

  * The snapshot NEVER includes `standards[].standard_id`,
    per-standard kappa values, weekly trend arrays, or any other
    substrate field. Those live in `evals/graduation/readiness.json`
    and surface only on `/admin/calibration` under founder auth.

  * Pending states are surfaced honestly with sentinel reasons —
    never coerced to 0 or to the design target. Mitchell et al. 2019
    (Model Cards for Model Reporting) on honest metric reporting.

Schema 1.0.0:

    {
      "schema_version": "1.0.0",
      "generated_at": "2026-04-25T18:00:00Z",
      "measured_system": {
        "state": "measured",
        "value": 0.872,
        "ci_low": 0.851,
        "ci_high": 0.893,
        "sample_size": 1234
      } | { "state": "pending_measurement", "reason": "..." },
      "measured_self_drift": { ... },
      "design_target": 0.9,
      "by_level": {
        "robo_labels": 43,
        "batch_approval": 0,
        "autonomous": 0
      },
      "standards_measured": 0,
      "standards_total": 47
    }

Usage:

    python3 reports/accuracy/generate.py \\
        --readiness evals/graduation/readiness.json \\
        --drift-dir evals/drift/reports \\
        --out reports/accuracy/latest.json

Cron-driven invocation lands in Phase C4 alongside the staleness
monitor + email alerting. For now this is a manual-or-CI generator
the founder runs after each substrate update.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1.0.0"
DESIGN_TARGET_KAPPA = 0.9
TOTAL_STANDARDS = 47


@dataclass
class Snapshot:
    schema_version: str
    generated_at: str
    measured_system: dict
    measured_self_drift: dict
    design_target: float
    by_level: dict
    standards_measured: int
    standards_total: int


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate the public accuracy snapshot."
    )
    parser.add_argument(
        "--readiness",
        type=Path,
        default=Path("evals/graduation/readiness.json"),
        help="Path to graduation readiness.json (substrate input).",
    )
    parser.add_argument(
        "--drift-dir",
        type=Path,
        default=Path("evals/drift/reports"),
        help="Directory of drift report JSON files. Newest by mtime wins.",
    )
    parser.add_argument(
        "--held-out-kappa",
        type=Path,
        default=Path("evals/held_out/kappa.json"),
        help=(
            "Path to held-out kappa fallback (substrate input). Used "
            "when readiness.json has no measured κ. Produced by "
            "tools/score_held_out_kappa.py."
        ),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("reports/accuracy/latest.json"),
        help="Where to write the public snapshot.",
    )
    args = parser.parse_args(argv)

    readiness = _safe_read_json(args.readiness)
    drift = _load_latest_drift(args.drift_dir)
    held_out = _safe_read_json(args.held_out_kappa)

    snapshot = build_snapshot(
        readiness=readiness,
        drift=drift,
        held_out=held_out,
        now=datetime.now(timezone.utc),
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(asdict(snapshot), indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


def build_snapshot(
    *,
    readiness: dict | None,
    drift: dict | None,
    held_out: dict | None = None,
    now: datetime,
) -> Snapshot:
    """Pure builder. Tests exercise this with hand-crafted inputs.

    Resolution order for system κ:
      1. readiness.json — preferred when graduation_metrics has
         populated per-standard κ values.
      2. held_out kappa fallback — used while readiness is still
         pending. Honest measurement against Robert's blind labels;
         single aggregate κ + 95% CI across the held-out set.
      3. pending — no data either way; render the sentinel.
    """
    measured_system = _aggregate_system_kappa(readiness)
    if measured_system.get("state") == "pending_measurement":
        held_out_kappa = _held_out_to_kappa(held_out)
        if held_out_kappa is not None:
            measured_system = held_out_kappa
    measured_self_drift = _drift_to_kappa(drift)

    by_level = {"robo_labels": 0, "batch_approval": 0, "autonomous": 0}
    if readiness and isinstance(readiness.get("by_level"), dict):
        for k in by_level.keys():
            v = readiness["by_level"].get(k, 0)
            by_level[k] = int(v) if isinstance(v, (int, float)) else 0

    standards_measured = 0
    if readiness:
        standards_measured = sum(
            1
            for s in readiness.get("standards", [])
            if _has_measured_kappa(s)
        )

    standards_total = TOTAL_STANDARDS
    if readiness and isinstance(readiness.get("standards_evaluated"), int):
        # `standards_evaluated` is the count of standards that
        # graduation_metrics.py considered. Don't overwrite our
        # locked total just because the substrate has fewer rows.
        standards_total = max(TOTAL_STANDARDS, readiness["standards_evaluated"])

    return Snapshot(
        schema_version=SCHEMA_VERSION,
        generated_at=_iso(now),
        measured_system=measured_system,
        measured_self_drift=measured_self_drift,
        design_target=DESIGN_TARGET_KAPPA,
        by_level=by_level,
        standards_measured=standards_measured,
        standards_total=standards_total,
    )


def _aggregate_system_kappa(readiness: dict | None) -> dict:
    """Sample-weighted aggregate of per-standard measured κ.

    Mirrors `aggregateSystemKappa` in `src/lib/accuracy-data.ts` so
    the public number matches the substrate-side computation.
    """
    if not readiness:
        return _pending(
            "no readiness.json — graduation metrics have not been "
            "computed yet"
        )

    standards = readiness.get("standards", [])
    measured = [s for s in standards if _has_measured_kappa(s)]
    if not measured:
        return _pending("no standards have completed the weekly κ series")

    sum_value = 0.0
    sum_weight = 0.0
    sum_ci_low = 0.0
    sum_ci_high = 0.0
    total_sample = 0
    for s in measured:
        kappa = _pick_kappa(s)
        weight = max(1, kappa["sample_size"])
        sum_value += kappa["value"] * weight
        sum_ci_low += kappa["ci_low"] * weight
        sum_ci_high += kappa["ci_high"] * weight
        sum_weight += weight
        total_sample += kappa["sample_size"]

    return {
        "state": "measured",
        "value": round(sum_value / sum_weight, 4),
        "ci_low": round(sum_ci_low / sum_weight, 4),
        "ci_high": round(sum_ci_high / sum_weight, 4),
        "sample_size": total_sample,
    }


def _drift_to_kappa(drift: dict | None) -> dict:
    if not drift or not isinstance(drift.get("kappa"), (int, float)):
        return _pending(
            "Session 7 drift panel awaiting blind re-label + score"
        )
    value = float(drift["kappa"])
    return {
        "state": "measured",
        "value": round(value, 4),
        "ci_low": round(float(drift.get("kappa_ci_low", value)), 4),
        "ci_high": round(float(drift.get("kappa_ci_high", value)), 4),
        "sample_size": int(drift.get("sample_size", 0)),
    }


def _held_out_to_kappa(held_out: dict | None) -> dict | None:
    """Map held-out aggregate κ into the public-snapshot shape.

    Returns None when no usable data is present; callers fall back
    to the pending sentinel. The same privacy contract applies:
    only the aggregate (κ, CI, n) is exposed publicly. The
    `by_standard` rows in `held_out` are substrate and never leak
    here.
    """
    if not held_out or not isinstance(held_out.get("kappa"), (int, float)):
        return None
    value = float(held_out["kappa"])
    sample = int(held_out.get("evaluated", 0))
    return {
        "state": "measured",
        "value": round(value, 4),
        "ci_low": round(float(held_out.get("ci_low", value)), 4),
        "ci_high": round(float(held_out.get("ci_high", value)), 4),
        "sample_size": sample,
    }


def _pending(reason: str) -> dict:
    return {"state": "pending_measurement", "reason": reason}


def _has_measured_kappa(standard: Any) -> bool:
    """A standard has measured κ when either the autonomous or
    batch_approval criteria block reports a kappa value."""
    if not isinstance(standard, dict):
        return False
    for tier in ("autonomous", "batch_approval"):
        block = standard.get(tier)
        if not isinstance(block, dict):
            continue
        criteria = block.get("criteria")
        if not isinstance(criteria, dict):
            continue
        kappa = criteria.get("kappa")
        if isinstance(kappa, dict) and isinstance(kappa.get("value"), (int, float)):
            return True
    return False


def _pick_kappa(standard: dict) -> dict:
    """Prefer autonomous-tier κ when present; otherwise batch_approval."""
    for tier in ("autonomous", "batch_approval"):
        block = standard.get(tier) or {}
        criteria = block.get("criteria") or {}
        kappa = criteria.get("kappa")
        if isinstance(kappa, dict) and isinstance(kappa.get("value"), (int, float)):
            sample = (block.get("sample") or {}).get("size") or 0
            return {
                "value": float(kappa["value"]),
                "ci_low": float(kappa.get("ci_low", kappa["value"])),
                "ci_high": float(kappa.get("ci_high", kappa["value"])),
                "sample_size": int(sample),
            }
    return {"value": 0.0, "ci_low": 0.0, "ci_high": 0.0, "sample_size": 0}


def _safe_read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _load_latest_drift(directory: Path) -> dict | None:
    if not directory.exists() or not directory.is_dir():
        return None
    candidates = sorted(
        (p for p in directory.iterdir() if p.is_file() and p.suffix == ".json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for p in candidates:
        data = _safe_read_json(p)
        if data is not None:
            return data
    return None


def _iso(now: datetime) -> str:
    return now.strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    raise SystemExit(main())
