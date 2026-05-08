#!/usr/bin/env python3
"""Behavioral parity gate for humanize.py across the four packages.

The customer-facing labels live in four hand-maintained copies because
each package can't import from the others (CLI / MCP / LSP / GH Action
are all thin clients with no shared lib). They share the same function
surface — humanize_verdict, humanize_severity, humanize_review_reason
— and ADR 2026-04-29 §9 locks the vocabulary they emit.

Byte parity isn't the right gate (docstrings legitimately diverge per
package). What we want is: given the same inputs, all four return the
same outputs. This script enumerates every interesting input combo
and asserts identical results.

Sources:
  1. cli-client/contentrx/humanize.py
  2. mcp-server/src/contentrx_mcp/humanize.py
  3. lsp-server/src/contentrx_lsp/humanize.py
  4. github-action/src/humanize.py

Exits 0 on parity, 1 with a row-by-row diff on divergence.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent

SOURCES: dict[str, Path] = {
    "cli":         ROOT / "cli-client"     / "contentrx"     / "humanize.py",
    "mcp":         ROOT / "mcp-server"     / "src" / "contentrx_mcp" / "humanize.py",
    "lsp":         ROOT / "lsp-server"     / "src" / "contentrx_lsp" / "humanize.py",
    "gh-action":   ROOT / "github-action"  / "src"          / "humanize.py",
}

# Every interesting input shape for each function. The cases drive
# the assertion matrix — adding a case here exercises it across all
# four modules automatically.

VERDICT_CASES: list[tuple[str, int, bool]] = [
    # (verdict, finding_count, has_ship_blocker)
    ("pass", 0, False),
    ("pass", 5, False),  # finding_count is irrelevant for pass
    ("pass", 0, True),   # ship_blocker is irrelevant for pass
    ("review_recommended", 0, False),
    ("review_recommended", 3, False),
    ("review_recommended", 0, True),
    ("violation", 0, False),
    ("violation", 1, False),  # singular grammar
    ("violation", 2, False),
    ("violation", 7, False),
    ("violation", 1, True),   # ship_blocker overrides count
    ("violation", 7, True),
    # Defensive fallback for unknown verdicts.
    ("error", 0, False),
    ("malformed_state", 0, False),
    ("", 0, False),
]

SEVERITY_CASES: list[tuple[str, bool]] = [
    # (severity, is_ship_blocker)
    ("high", False),
    ("high", True),    # red ship-blocker tier
    ("medium", False),
    ("medium", True),  # is_ship_blocker is gated to high
    ("low", False),
    ("low", True),
    # Defensive fallback for unknown severities.
    ("critical", False),
    ("info", False),
    ("", False),
]

REVIEW_REASON_CASES: list[str | None] = [
    None,
    "",
    "low_confidence",
    "standards_conflict",
    "ensemble_disagreement",
    "situation_ambiguity",
    "out_of_distribution",
    "novel_pattern",
    "low_confidence_mixed_signals",
    "high_confidence_mixed_signals",
    # Defensive fallback for unknown reasons.
    "future_subtype",
    "stale_pre_session_2_value",
]


def _load(label: str, path: Path) -> ModuleType:
    """Load a humanize.py file as an isolated module, no package import.

    importlib.util.spec_from_file_location avoids polluting sys.modules
    with names that collide across packages (every copy is named
    `humanize`).
    """
    spec = importlib.util.spec_from_file_location(
        f"_parity_{label}", path,
    )
    if spec is None or spec.loader is None:
        raise SystemExit(f"Could not load module for {label} at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _diff(label_a: str, label_b: str, args: object,
          out_a: object, out_b: object) -> str:
    return (
        f"  ~ inputs: {args!r}\n"
        f"      {label_a}: {out_a!r}\n"
        f"      {label_b}: {out_b!r}"
    )


def main() -> int:
    modules: dict[str, ModuleType] = {}
    for label, path in SOURCES.items():
        if not path.exists():
            print(f"[parity] missing humanize source: {path}",
                  file=sys.stderr)
            return 1
        modules[label] = _load(label, path)

    # canonical = cli-client (most-complete docstrings; the file Robert
    # iterates on first when adding labels). The other three must match
    # its outputs.
    canonical_label = "cli"
    canonical = modules[canonical_label]
    others = {k: v for k, v in modules.items() if k != canonical_label}

    failures: list[str] = []

    # humanize_verdict
    for args in VERDICT_CASES:
        expected = canonical.humanize_verdict(*args)
        for label, mod in others.items():
            actual = mod.humanize_verdict(*args)
            if actual != expected:
                failures.append(
                    f"[verdict] {label} diverges from {canonical_label}\n"
                    + _diff(canonical_label, label, args, expected, actual)
                )

    # humanize_severity
    for args in SEVERITY_CASES:
        expected = canonical.humanize_severity(*args)
        for label, mod in others.items():
            actual = mod.humanize_severity(*args)
            if actual != expected:
                failures.append(
                    f"[severity] {label} diverges from {canonical_label}\n"
                    + _diff(canonical_label, label, args, expected, actual)
                )

    # humanize_review_reason
    for value in REVIEW_REASON_CASES:
        expected = canonical.humanize_review_reason(value)
        for label, mod in others.items():
            actual = mod.humanize_review_reason(value)
            if actual != expected:
                failures.append(
                    f"[review_reason] {label} diverges from {canonical_label}\n"
                    + _diff(canonical_label, label, value, expected, actual)
                )

    if failures:
        print(
            f"[parity] {len(failures)} divergence(s) across humanize.py "
            f"copies (canonical: {canonical_label}):",
            file=sys.stderr,
        )
        for f in failures:
            print(f, file=sys.stderr)
        return 1

    total_cases = (
        len(VERDICT_CASES) + len(SEVERITY_CASES) + len(REVIEW_REASON_CASES)
    )
    print(
        f"[parity] OK — all four humanize.py modules agree across "
        f"{total_cases} input cases × 3 functions"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
