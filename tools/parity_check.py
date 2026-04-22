#!/usr/bin/env python3
"""
JS/Python preprocessor parity check.

Runs every case in `tests/corpus/parity_corpus.json` through:
  1. The Python preprocessor (`content_checker.preprocess.run_preprocess`)
  2. The Figma plugin's JS preprocessor, executed by `tools/parity_js_runner.mjs`

Compares the two verdicts and reports any divergence. Exits 0 on full
agreement, 1 on any divergence.

Run locally:
    python3 tools/parity_check.py
    python3 tools/parity_check.py --corpus path/to/other-corpus.json
    python3 tools/parity_check.py --verbose

Used by .github/workflows/parity.yml as a CI gate. See
tests/corpus/README.md for selection criteria + how to extend the corpus.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CORPUS = REPO_ROOT / "tests" / "corpus" / "parity_corpus.json"
JS_RUNNER = REPO_ROOT / "tools" / "parity_js_runner.mjs"


def _ensure_python_path() -> None:
    """Make `content_checker` importable when running from the repo root."""
    src = REPO_ROOT / "src"
    if src.is_dir() and str(src) not in sys.path:
        sys.path.insert(0, str(src))


def python_verdicts(cases: list[dict]) -> list[dict]:
    """Run every case through `run_preprocess` and return normalized verdicts."""
    _ensure_python_path()
    from content_checker.preprocess import run_preprocess  # type: ignore

    out = []
    for case in cases:
        text = case.get("input", "")
        content_type = case.get("content_type", "short_ui_copy")
        try:
            violations = run_preprocess(text, content_type=content_type)
        except Exception as exc:  # noqa: BLE001 — we want the raw message
            out.append({"error": str(exc), "violations": [], "suppressed_ids": []})
            continue
        # `_ViolationList` carries .suppressed_ids; bare list does not.
        suppressed_ids = sorted(getattr(violations, "suppressed_ids", set()) or [])
        out.append(
            {
                "violations": [
                    {
                        "standard_id": v.standard_id,
                        "issue": (v.issue or None),
                        "suggestion": (v.suggestion or None),
                    }
                    for v in violations
                ],
                "suppressed_ids": suppressed_ids,
            }
        )
    return out


def js_verdicts(cases: list[dict]) -> list[dict]:
    """Spawn the Node harness once, send all cases over stdin, return parsed verdicts."""
    if not JS_RUNNER.is_file():
        raise FileNotFoundError(f"JS runner not found at {JS_RUNNER}")
    payload = json.dumps(
        [
            {"input": c.get("input", ""), "content_type": c.get("content_type", "short_ui_copy")}
            for c in cases
        ]
    )
    proc = subprocess.run(
        ["node", str(JS_RUNNER)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"parity_js_runner exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr}\n"
            f"stdout:\n{proc.stdout[:4000]}"
        )
    out = json.loads(proc.stdout)
    # Normalize suppressed_ids ordering to make diffs deterministic.
    for entry in out:
        entry["suppressed_ids"] = sorted(entry.get("suppressed_ids") or [])
    return out


def _verdict_summary(entry: dict) -> tuple[set[str], set[str]]:
    violations = {v["standard_id"] for v in entry.get("violations") or []}
    suppressed = set(entry.get("suppressed_ids") or [])
    return violations, suppressed


def diff_case(case: dict, py: dict, js: dict) -> str | None:
    """Return a printable diff string if Python ≠ JS, else None."""
    py_v, py_s = _verdict_summary(py)
    js_v, js_s = _verdict_summary(js)
    py_err = py.get("error")
    js_err = js.get("error")

    if py_err or js_err:
        return (
            f"  ⚠ Runtime error\n"
            f"    python: {py_err or 'OK'}\n"
            f"    js:     {js_err or 'OK'}"
        )

    if py_v == js_v and py_s == js_s:
        return None

    lines = []
    only_in_py_v = py_v - js_v
    only_in_js_v = js_v - py_v
    if only_in_py_v:
        lines.append(f"    violations only in Python: {sorted(only_in_py_v)}")
    if only_in_js_v:
        lines.append(f"    violations only in JS:     {sorted(only_in_js_v)}")
    only_in_py_s = py_s - js_s
    only_in_js_s = js_s - py_s
    if only_in_py_s:
        lines.append(f"    suppressed only in Python: {sorted(only_in_py_s)}")
    if only_in_js_s:
        lines.append(f"    suppressed only in JS:     {sorted(only_in_js_s)}")
    return "\n".join(lines)


def load_corpus(path: Path) -> list[dict]:
    if not path.is_file():
        raise FileNotFoundError(f"Corpus not found at {path}")
    raw = json.loads(path.read_text())
    cases = raw.get("cases") if isinstance(raw, dict) else raw
    if not isinstance(cases, list):
        raise ValueError(f"Corpus at {path} must be a list (or {{cases: [...]}}); got {type(raw).__name__}")
    return cases


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    cases = load_corpus(args.corpus)
    print(f"parity_check: {len(cases)} cases from {args.corpus.relative_to(REPO_ROOT)}")

    py_out = python_verdicts(cases)
    js_out = js_verdicts(cases)

    if len(py_out) != len(js_out):
        print(
            f"FATAL: shape mismatch — python returned {len(py_out)} verdicts, "
            f"js returned {len(js_out)}",
            file=sys.stderr,
        )
        return 2

    divergent = []
    for i, case in enumerate(cases):
        diff = diff_case(case, py_out[i], js_out[i])
        if diff is None:
            if args.verbose:
                py_v, _ = _verdict_summary(py_out[i])
                print(f"  ✓ [{i+1:>3}/{len(cases)}] {case.get('case_id', case.get('input',''))[:60]} "
                      f"(violations: {sorted(py_v) or '∅'})")
            continue
        divergent.append(i)
        case_id = case.get("case_id") or case.get("input", "")[:60]
        print(f"\n  ✗ DIVERGENCE in case [{i+1}/{len(cases)}]: {case_id}")
        print(f"    input: {case.get('input','')[:200]}")
        print(f"    content_type: {case.get('content_type','short_ui_copy')}")
        print(diff)

    print()
    if not divergent:
        print(f"✓ FULL AGREEMENT across {len(cases)} cases.")
        return 0
    print(
        f"✗ {len(divergent)}/{len(cases)} cases diverged. "
        f"Fix the JS preprocessor in figma-plugin/ui.html OR add the "
        f"corresponding check to src/content_checker/preprocess.py."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
