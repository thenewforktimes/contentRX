#!/usr/bin/env python3
"""Case-study workflow tool — clone, crawl, evaluate, summarize.

Per the post-pivot plan: building the named-expert moat means running
ContentRX over real OSS products, recording where the engine agrees
with hand-judgment (and where it doesn't), and publishing the findings.

This tool is the mechanical scaffold for that workflow. It does NOT
make content design judgments — that's the human's job. It clones a
target, extracts UI strings via the GitHub Action's regex extractor,
runs each string through the engine (or /api/check), and writes
structured JSONL artifacts that the human then annotates.

Subcommands
-----------

  crawl  — clone a target repo, extract strings, write to
           evals/case-studies/<slug>/extracted_strings.jsonl

  evaluate — read extracted_strings.jsonl, send each to /api/check
             (or the local engine), write engine_results.jsonl

  summarize — produce a markdown summary from engine_results.jsonl

Usage
-----

    # Clone PostHog (depth=1) and extract strings from frontend/src/scenes/
    python3 tools/case_study.py crawl \\
        --slug posthog \\
        --repo https://github.com/PostHog/posthog \\
        --paths "frontend/src/scenes/**/*.{tsx,jsx}"

    # Send the first 25 unique strings through /api/check
    python3 tools/case_study.py evaluate \\
        --slug posthog \\
        --via api \\
        --api-key "$CONTENTRX_API_KEY" \\
        --limit 25

    # Or use the local engine (skips quota; needs ANTHROPIC_API_KEY)
    python3 tools/case_study.py evaluate \\
        --slug posthog \\
        --via engine \\
        --limit 25

    # Roll up the results
    python3 tools/case_study.py summarize --slug posthog
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import asdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "github-action" / "src"))
sys.path.insert(0, str(REPO_ROOT / "src"))

# Reuse the GitHub Action's regex extractor — same file-type coverage
# the action already ships with, so case-study findings transfer when
# we move from study to action-driven enforcement on the target.
from extract import Extraction, extract_strings, matches_glob  # noqa: E402

CASE_STUDIES_DIR = REPO_ROOT / "evals" / "case-studies"
CLONE_CACHE_DIR = Path("/tmp") / "contentrx-case-studies"


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def slug_dir(slug: str) -> Path:
    """Resolve the per-target working directory under evals/case-studies/."""
    if not slug or "/" in slug or slug.startswith("."):
        raise ValueError(f"invalid slug: {slug!r}")
    d = CASE_STUDIES_DIR / slug
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


# ---------------------------------------------------------------------------
# crawl
# ---------------------------------------------------------------------------


def cmd_crawl(args: argparse.Namespace) -> int:
    workdir = slug_dir(args.slug)
    clone_path = CLONE_CACHE_DIR / args.slug

    print(f"crawl {args.slug}: clone {args.repo} → {clone_path}", flush=True)
    if clone_path.exists() and not args.refresh:
        print("  (clone cache hit — pass --refresh to re-clone)")
    else:
        if clone_path.exists():
            shutil.rmtree(clone_path)
        clone_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", args.repo, str(clone_path)],
            check=True,
            timeout=600,
        )

    # Resolve commit so we can reproduce the crawl later. `git rev-parse
    # HEAD` runs cheap.
    head_sha = subprocess.run(
        ["git", "-C", str(clone_path), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    # Walk and apply path filters.
    paths = args.paths or [
        "**/*.tsx", "**/*.jsx", "**/*.html",
    ]
    print(f"  walking with paths={paths}", flush=True)
    matched_files: list[Path] = []
    for p in clone_path.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(clone_path).as_posix()
        if any(matches_glob(rel, glob) for glob in paths):
            matched_files.append(p)
    print(f"  matched {len(matched_files)} files", flush=True)

    # Extract.
    extractions: list[Extraction] = []
    for p in matched_files:
        try:
            extractions.extend(extract_strings(p))
        except Exception as exc:  # noqa: BLE001
            print(f"  warn: {p}: {exc}", file=sys.stderr)

    print(f"  extracted {len(extractions)} raw strings (pre-dedupe)", flush=True)

    # Dedupe by exact text (case-sensitive). Keep first source location.
    seen: dict[str, Extraction] = {}
    for ext in extractions:
        if ext.text not in seen:
            seen[ext.text] = ext
    deduped = list(seen.values())
    pre_filter = len(deduped)

    # Case-study filter: drop anything that looks like JSX-expression
    # bleed-through. The GH Action's regex extractor is intentionally
    # permissive (BUILD_PLAN §15 plans an AST upgrade); for research
    # iteration we want a cleaner set, even if we miss some real strings.
    deduped = [e for e in deduped if _likely_real_copy(e.text)]
    print(
        f"  {pre_filter} unique strings → {len(deduped)} after expression filter",
        flush=True,
    )

    # Write extracted_strings.jsonl. One JSON record per line:
    # {"text", "kind", "source_file", "line", "target", "head_sha"}.
    out_path = workdir / "extracted_strings.jsonl"
    rows = []
    for ext in deduped:
        # Trim source_file to be repo-relative — easier to read in diffs
        # and not tied to whoever's machine ran the crawl.
        src = ext.source_file
        try:
            src = str(Path(ext.source_file).relative_to(clone_path))
        except ValueError:
            pass
        rows.append({
            "text": ext.text,
            "kind": ext.kind,
            "source_file": src,
            "line": ext.line,
            "target": args.slug,
            "head_sha": head_sha,
        })
    write_jsonl(out_path, rows)
    print(f"  wrote {out_path} ({len(rows)} rows)", flush=True)

    # Update README with the latest crawl metadata.
    _write_readme(workdir, args.slug, args.repo, head_sha, len(rows), paths)
    return 0


def _write_readme(
    workdir: Path,
    slug: str,
    repo: str,
    head_sha: str,
    string_count: int,
    paths: list[str],
) -> None:
    readme = workdir / "README.md"
    paths_md = "\n".join(f"  - `{p}`" for p in paths)
    readme.write_text(
        f"""# Case study: {slug}

Working directory for the {slug} case study.

## Source

- **Repo:** `{repo}`
- **Last crawled HEAD:** `{head_sha}`
- **Path filters:**
{paths_md}
- **Strings extracted (deduped):** {string_count}

## Files in this folder

- `extracted_strings.jsonl` — raw strings pulled by the regex extractor.
  One JSON record per line: `{{text, kind, source_file, line, target, head_sha}}`.
  Source files are repo-relative.
- `engine_results.jsonl` — engine verdicts keyed by the same text. Written
  by `case_study.py evaluate`.
- `summary.md` — narrative roll-up. Hand-written with help from
  `case_study.py summarize`.
- `notes.md` — running observations as the human reads through results.
- `.gitignore` — excludes the cloned source tree from git.

## Workflow

1. **Crawl** (this step ran already):
   ```bash
   python3 tools/case_study.py crawl --slug {slug} \\
       --repo {repo} \\
       --paths "{paths[0] if paths else '**/*.tsx'}"
   ```
2. **Evaluate** — send strings through the engine. Free-tier API
   account = 25 scans/month, so cap with `--limit`:
   ```bash
   python3 tools/case_study.py evaluate --slug {slug} --via api \\
       --api-key "$CONTENTRX_API_KEY" --limit 25
   ```
   Or skip the API quota and call the local engine directly (still
   pays Anthropic credit, but no /api/check counter):
   ```bash
   python3 tools/case_study.py evaluate --slug {slug} --via engine --limit 25
   ```
3. **Summarize**:
   ```bash
   python3 tools/case_study.py summarize --slug {slug}
   ```

## What this study is NOT

- It is not yet the published case study. Until a maintainer of the
  target signs off, the `docs-site/content/case-studies/{slug}/page.mdx`
  artifact stays unwritten. The CI guard in
  `docs-site/lib/case-studies.ts` blocks merges without
  `maintainer_approval: true`.
- It is not a definitive judgment of the target's content quality.
  The engine reports its read; the human's notes record where the
  read was wrong. Disagreement is the point.
""",
        encoding="utf-8",
    )

    gitignore = workdir / ".gitignore"
    if not gitignore.exists():
        # The cloned source tree is huge; never commit it. The crawl
        # reproduces from the recorded `head_sha`.
        gitignore.write_text("# Cloned source from upstream — re-clone via tools/case_study.py crawl.\nsource/\n")


def _likely_real_copy(text: str) -> bool:
    """Stricter than the GH Action's `_looks_like_copy` — drops strings
    that almost certainly leaked from JSX expressions / attribute soup
    that the v1 regex extractor couldn't disambiguate.

    Reject when the text contains:
      - `{` or `}` — JSX expression bleed (`{onClose()}> Cancel`)
      - `()` — JS function call left in
      - `=>` — arrow function
      - `&&` / `||` — boolean expression
      - leading `=` — assignment / attribute artefact
      - looks like a code identifier path (`./foo`, `frontend/src/...`)

    Accept the false-negative cost (a real string with a `{` literal
    inside it gets dropped) — the alternative is burning quota on
    `setName(value)} onKeyDown=...` which is strictly noise.
    """
    if "{" in text or "}" in text:
        return False
    if "()" in text:
        return False
    if "=>" in text or "&&" in text or "||" in text:
        return False
    stripped = text.strip()
    if stripped.startswith("=") or stripped.startswith("./") or stripped.startswith("../"):
        return False
    if "/" in stripped and " " not in stripped:
        # Path-like with no spaces — file path / URL fragment, not copy.
        return False
    return True


# ---------------------------------------------------------------------------
# evaluate
# ---------------------------------------------------------------------------


def cmd_evaluate(args: argparse.Namespace) -> int:
    workdir = slug_dir(args.slug)
    extracted = workdir / "extracted_strings.jsonl"
    if not extracted.is_file():
        print(f"error: {extracted} not found — run crawl first", file=sys.stderr)
        return 1

    rows = read_jsonl(extracted)
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]
    print(f"evaluate {args.slug}: {len(rows)} strings via {args.via}", flush=True)

    if args.via == "api":
        return _evaluate_via_api(workdir, rows, args)
    if args.via == "engine":
        return _evaluate_via_engine(workdir, rows, args)
    print(f"error: unknown --via {args.via!r}", file=sys.stderr)
    return 2


def _evaluate_via_api(
    workdir: Path,
    rows: list[dict],
    args: argparse.Namespace,
) -> int:
    api_key = args.api_key or os.environ.get("CONTENTRX_API_KEY") or ""
    if not api_key.startswith("cx_"):
        print(
            "error: --api-key (or $CONTENTRX_API_KEY) must be a cx_ token",
            file=sys.stderr,
        )
        return 1
    base_url = args.base_url or "https://contentrx.io"

    out_path = workdir / "engine_results.jsonl"
    results: list[dict] = []
    for i, row in enumerate(rows, 1):
        body = json.dumps(
            {"text": row["text"], "content_type": _heuristic_content_type(row)},
        ).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/api/check",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            payload = {
                "error": f"HTTP {exc.code}",
                "body": exc.read().decode("utf-8", errors="replace")[:1000],
            }
            if exc.code == 402:
                print(f"  quota exhausted at row {i} — stopping", flush=True)
                results.append({"input": row, "response": payload})
                break
        except (urllib.error.URLError, OSError) as exc:
            payload = {"error": str(exc)}
        elapsed_ms = int((time.time() - t0) * 1000)
        results.append({
            "input": row,
            "response": payload,
            "elapsed_ms": elapsed_ms,
        })
        verdict = payload.get("verdict", "?")
        reason = payload.get("review_reason") or "—"
        print(
            f"  [{i}/{len(rows)}] {verdict:<22} reason={reason:<22} "
            f"text={row['text'][:50]!r}",
            flush=True,
        )

    write_jsonl(out_path, results)
    print(f"  wrote {out_path} ({len(results)} rows)", flush=True)
    return 0


def _evaluate_via_engine(
    workdir: Path,
    rows: list[dict],
    args: argparse.Namespace,
) -> int:
    """Call the local Python engine directly. Bypasses /api/check quota
    but still pays Anthropic credit (the engine actually runs the LLM)."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "error: ANTHROPIC_API_KEY must be set for --via engine",
            file=sys.stderr,
        )
        return 1

    from content_checker import check  # noqa: E402

    out_path = workdir / "engine_results.jsonl"
    results: list[dict] = []
    for i, row in enumerate(rows, 1):
        ctype = _heuristic_content_type(row)
        t0 = time.time()
        try:
            result = check(text=row["text"], content_type=ctype)
            payload = result.to_public_envelope()
        except Exception as exc:  # noqa: BLE001
            payload = {"error": str(exc)}
        elapsed_ms = int((time.time() - t0) * 1000)
        results.append({
            "input": row,
            "response": payload,
            "elapsed_ms": elapsed_ms,
        })
        verdict = payload.get("verdict", "?")
        reason = payload.get("review_reason") or "—"
        print(
            f"  [{i}/{len(rows)}] {verdict:<22} reason={reason:<22} "
            f"text={row['text'][:50]!r}",
            flush=True,
        )

    write_jsonl(out_path, results)
    print(f"  wrote {out_path} ({len(results)} rows)", flush=True)
    return 0


def _heuristic_content_type(row: dict) -> str:
    """Map the extractor's `kind` to a coarse content_type guess.
    The engine's classifier will refine; this is the seed value.

    Per `src/lib/engine-taxonomy.ts`, the eight valid content_types
    are: button_cta, error_message, confirmation, tooltip_microcopy,
    ui_label, short_ui_copy, long_form_copy, heading.

    Placeholder attribute mapping note. `placeholder` is *example
    text shown inside an empty input* — not a label. The PostHog
    iteration-1 crawl flagged this when the engine flagged "Acme
    Inc." (placeholder text on the org-name input) as a PRF-03
    trailing-period violation. The actual bug there was that
    "Acme Inc." is a legal-entity-suffix abbreviation and the trailing
    period belongs; but the heuristic mapping (placeholder → ui_label)
    also routes the string through PRF-03 unnecessarily strictly.
    Placeholders are now mapped to short_ui_copy, which gets a more
    permissive read.
    """
    kind = row.get("kind", "")
    if kind.startswith("attr:"):
        attr = kind.split(":", 1)[1]
        if attr == "label":
            return "ui_label"
        if attr == "placeholder":
            # Was ui_label — corrected per case-study iteration-1
            # finding (PostHog "Acme Inc." false positive).
            return "short_ui_copy"
        if attr in {"alt", "title"}:
            # `alt` labels images; `title` is a hover tooltip in HTML.
            # Both are short, label-flavored copy.
            return "ui_label"
        if attr in {"description", "tooltip", "subtitle"}:
            return "tooltip_microcopy"
        if attr == "heading":
            return "heading"
    # JSXText defaults: probably body or heading. The engine will
    # reclassify based on length + content.
    text = row.get("text", "")
    if len(text) <= 25:
        return "short_ui_copy"
    return "long_form_copy"


# ---------------------------------------------------------------------------
# summarize
# ---------------------------------------------------------------------------


def cmd_summarize(args: argparse.Namespace) -> int:
    workdir = slug_dir(args.slug)
    results_path = workdir / "engine_results.jsonl"
    rows = read_jsonl(results_path)
    if not rows:
        print(f"error: {results_path} is empty or missing — run evaluate first", file=sys.stderr)
        return 1

    verdict_counts: Counter[str] = Counter()
    reason_counts: Counter[str] = Counter()
    severity_counts: Counter[str] = Counter()
    standards_or_issues: Counter[str] = Counter()
    error_count = 0

    for row in rows:
        resp = row.get("response", {})
        if "error" in resp:
            error_count += 1
            continue
        verdict_counts[resp.get("verdict", "unknown")] += 1
        if reason := resp.get("review_reason"):
            reason_counts[reason] += 1
        for v in resp.get("violations") or []:
            severity_counts[v.get("severity", "unknown")] += 1
            issue = v.get("issue") or "<no issue>"
            standards_or_issues[issue[:80]] += 1

    summary_path = workdir / "summary.md"
    lines: list[str] = []
    lines.append(f"# {args.slug} — engine results summary")
    lines.append("")
    lines.append(f"Generated from `engine_results.jsonl` ({len(rows)} rows).")
    lines.append("")
    if error_count:
        lines.append(f"**Errors:** {error_count} request(s) failed (HTTP error or engine exception).")
        lines.append("")
    lines.append("## Verdict distribution")
    lines.append("")
    for verdict, n in verdict_counts.most_common():
        lines.append(f"- `{verdict}`: {n}")
    lines.append("")
    if reason_counts:
        lines.append("## Review reasons (when verdict = review_recommended)")
        lines.append("")
        for reason, n in reason_counts.most_common():
            lines.append(f"- `{reason}`: {n}")
        lines.append("")
    if severity_counts:
        lines.append("## Severity (across all violations)")
        lines.append("")
        for sev, n in severity_counts.most_common():
            lines.append(f"- `{sev}`: {n}")
        lines.append("")
    if standards_or_issues:
        lines.append("## Top issue strings")
        lines.append("")
        lines.append("Issues are surfaced verbatim — no `standard_id` mapping per ADR 2026-04-25.")
        lines.append("")
        for issue, n in standards_or_issues.most_common(10):
            lines.append(f"- ({n}×) {issue}")
        lines.append("")
    lines.append("## Next step")
    lines.append("")
    lines.append("Skim the high-severity / review_recommended rows by hand. Where the engine got it right, the")
    lines.append("standards library worked. Where it got it wrong, capture the case in `notes.md` — those")
    lines.append("disagreements feed the refinement log and become the case study's punchline.")
    lines.append("")
    summary_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {summary_path}", flush=True)
    return 0


# ---------------------------------------------------------------------------
# arg parsing
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_crawl = sub.add_parser("crawl", help="clone a target and extract strings")
    p_crawl.add_argument("--slug", required=True, help="case-study slug, e.g. 'posthog'")
    p_crawl.add_argument("--repo", required=True, help="git URL to clone (depth=1)")
    p_crawl.add_argument(
        "--paths",
        nargs="+",
        help="globs to walk inside the clone, e.g. 'frontend/src/**/*.{tsx,jsx}'",
    )
    p_crawl.add_argument(
        "--refresh",
        action="store_true",
        help="re-clone even if /tmp/contentrx-case-studies/<slug> already exists",
    )
    p_crawl.set_defaults(func=cmd_crawl)

    p_eval = sub.add_parser("evaluate", help="run extracted strings through the engine")
    p_eval.add_argument("--slug", required=True)
    p_eval.add_argument("--via", choices=("api", "engine"), default="api")
    p_eval.add_argument("--api-key", default=None, help="cx_... bearer token (or $CONTENTRX_API_KEY)")
    p_eval.add_argument("--base-url", default=None, help="override https://contentrx.io for testing")
    p_eval.add_argument("--limit", type=int, default=25, help="cap rows (0 = no cap)")
    p_eval.set_defaults(func=cmd_evaluate)

    p_sum = sub.add_parser("summarize", help="produce summary.md from engine_results.jsonl")
    p_sum.add_argument("--slug", required=True)
    p_sum.set_defaults(func=cmd_summarize)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
