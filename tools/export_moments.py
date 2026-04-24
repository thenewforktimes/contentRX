"""Export moments.py taxonomy + weights to a sibling JSON file.

Human-eval build plan Session 20. The docs site (`docs-site/`) is Node-
only at build time and cannot import Python; committing a JSON export
alongside `standards_library.json` gives the docs site a single-source
data contract matching the standards pattern.

Usage:
    python3 tools/export_moments.py

Writes to: src/content_checker/standards/moments_taxonomy.json

Keep this file in sync with moments.py. A pytest check in
`tests/test_moments_taxonomy_export.py` re-runs this export in-memory
and diffs against the committed JSON — drift fails CI rather than
silently skewing the docs site.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from content_checker.moments import (  # noqa: E402
    DEFAULT_MOMENT,
    MOMENT_CONFIDENCE_MATCHED,
    MOMENT_CONFIDENCE_THRESHOLD,
    MOMENT_TAXONOMY,
    MOMENT_WEIGHTS,
)

OUTPUT_PATH = (
    REPO_ROOT / "src" / "content_checker" / "standards" / "moments_taxonomy.json"
)

# Moments that represent situation-like properties — flag for UI
# filtering on the /model page. Mirrors the Session 20 scope:
# "Filter by situation-like properties (destructive, permission-gated,
# compliance)".
SITUATION_PROPERTY_BY_MOMENT: dict[str, str] = {
    "destructive_action": "destructive",
    "trust_permission": "permission-gated",
    "compliance_disclosure": "compliance",
}


def _weights_for(moment_id: str) -> list[dict[str, Any]]:
    entries = MOMENT_WEIGHTS.get(moment_id, [])
    out: list[dict[str, Any]] = []
    for w in entries:
        if is_dataclass(w):
            out.append(asdict(w))
        else:
            out.append({
                "standard_id": getattr(w, "standard_id", None),
                "modifier": getattr(w, "modifier", None),
                "rationale": getattr(w, "rationale", None),
            })
    return out


def build_payload() -> dict[str, Any]:
    moments: list[dict[str, Any]] = []
    for moment_id, description in MOMENT_TAXONOMY.items():
        moments.append({
            "id": moment_id,
            "description": description,
            "situation_property": SITUATION_PROPERTY_BY_MOMENT.get(moment_id),
            "weights": _weights_for(moment_id),
        })
    return {
        "schema_version": "1.0.0",
        "total_moments": len(MOMENT_TAXONOMY),
        "default_moment": DEFAULT_MOMENT,
        "confidence_threshold": MOMENT_CONFIDENCE_THRESHOLD,
        "confidence_matched": MOMENT_CONFIDENCE_MATCHED,
        "moments": moments,
    }


def main() -> None:
    payload = build_payload()
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    OUTPUT_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {OUTPUT_PATH} — {len(payload['moments'])} moments")


if __name__ == "__main__":
    main()
