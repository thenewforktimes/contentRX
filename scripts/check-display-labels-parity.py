#!/usr/bin/env python3
"""Parity gate: every DISPLAY_LABELS map across the four packages must
be byte-equivalent.

The map lives in four places because each package can't import from the
others (engine vs. MCP vs. CLI vs. TS web app). One source of truth +
three mirrors + this gate keeps them locked.

Sources:
  1. src/content_checker/labels.py:DISPLAY_LABELS  (engine — canonical)
  2. mcp-server/src/contentrx_mcp/display_labels.py:DISPLAY_LABELS
  3. cli-client/contentrx/display_labels.py:DISPLAY_LABELS
  4. src/lib/standard-display-names.ts:STANDARD_DISPLAY_LABELS

Each is a pure dict / object literal — no imports, no expressions —
so a regex parse is safe and avoids dragging in a Python or JS parser.

Exit 0 on parity, exit 1 with a unified diff on divergence.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SOURCES: dict[str, Path] = {
    "engine (labels.py)":
        ROOT / "src" / "content_checker" / "labels.py",
    "mcp (display_labels.py)":
        ROOT / "mcp-server" / "src" / "contentrx_mcp" / "display_labels.py",
    "ts (standard-display-names.ts)":
        ROOT / "src" / "lib" / "standard-display-names.ts",
}
# cli-client/contentrx/display_labels.py was a fourth mirror but is no
# longer needed — the CLI strips substrate per ADR 2026-04-25 and never
# renders standard_id, so the labels map was dead code that was kept
# in parity with the live consumers above. Removed in the 2026-05-11
# audit.

# Each line: `"GRM-01": "Punctuation",` — same syntax in Python and TS.
ENTRY_RE = re.compile(r'"([A-Z]+-\d+)":\s*"([^"]+)"')


def parse_python(path: Path) -> dict[str, str]:
    src = path.read_text(encoding="utf-8")
    block = re.search(
        r"DISPLAY_LABELS:\s*dict\[str,\s*str\]\s*=\s*\{(.+?)\n\}",
        src,
        re.DOTALL,
    )
    if not block:
        raise SystemExit(
            f"Could not locate DISPLAY_LABELS dict in {path}. Did the "
            "shape change? Update parse_python."
        )
    return dict(ENTRY_RE.findall(block.group(1)))


def parse_typescript(path: Path) -> dict[str, str]:
    src = path.read_text(encoding="utf-8")
    block = re.search(
        r"STANDARD_DISPLAY_LABELS:\s*Record<string,\s*string>\s*=\s*\{(.+?)\n\};",
        src,
        re.DOTALL,
    )
    if not block:
        raise SystemExit(
            f"Could not locate STANDARD_DISPLAY_LABELS in {path}. Did "
            "the shape change? Update parse_typescript."
        )
    return dict(ENTRY_RE.findall(block.group(1)))


def main() -> int:
    parsed: dict[str, dict[str, str]] = {}
    for label, path in SOURCES.items():
        if not path.exists():
            print(f"[parity] missing: {path}", file=sys.stderr)
            return 1
        parsed[label] = (
            parse_typescript(path)
            if path.suffix == ".ts"
            else parse_python(path)
        )

    canonical_label = "engine (labels.py)"
    canonical = parsed[canonical_label]
    ok = True
    for label, m in parsed.items():
        if label == canonical_label:
            continue
        if m == canonical:
            continue
        ok = False
        only_in_canonical = sorted(set(canonical) - set(m))
        only_in_other = sorted(set(m) - set(canonical))
        differs = sorted(
            k for k in canonical if k in m and canonical[k] != m[k]
        )
        print(f"[parity] {label} diverges from {canonical_label}:",
              file=sys.stderr)
        for k in only_in_canonical:
            print(f"  - missing entry: {k!r} → {canonical[k]!r}",
                  file=sys.stderr)
        for k in only_in_other:
            print(f"  + extra entry:   {k!r} → {m[k]!r}",
                  file=sys.stderr)
        for k in differs:
            print(
                f"  ~ value differs: {k!r} → "
                f"{canonical[k]!r} (engine) vs {m[k]!r} ({label})",
                file=sys.stderr,
            )

    if ok:
        sample = ", ".join(list(canonical)[:3])
        print(
            f"[parity] OK — all three DISPLAY_LABELS maps match "
            f"({len(canonical)} entries; sample: {sample}, …)"
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
