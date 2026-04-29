"""CLI entry point for the content standards checker.

Usage:
    python -m content_checker "Click here to learn more"
    python -m content_checker --interactive
    python -m content_checker --verbose "Your changes are saved."
    python -m content_checker --batch strings.txt
    python -m content_checker --batch strings.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from content_checker.batch import check_batch
from content_checker.models import (
    BatchResult,
    CheckResult,
    ContentItem,
    TokenUsage,
)
from content_checker.pipeline import check, check_unfiltered

MAX_BATCH_FILE_SIZE = 10 * 1024 * 1024
SUPPORTED_BATCH_EXTENSIONS = (".json", ".txt")


def print_result(
    text: str,
    result: CheckResult,
    latency: float,
    tokens: TokenUsage,
    verbose: bool = False,
) -> None:
    """Pretty-print a check result to the terminal."""
    verdict = result.overall_verdict
    icon = "✓" if verdict == "pass" else "✗"
    color = "\033[32m" if verdict == "pass" else "\033[31m"
    reset = "\033[0m"

    print(f"\n{color}{icon} {verdict.upper()}{reset}")
    print(f"  Content type: {result.content_type}")
    print(f"  {result.summary}")

    if result.violations:
        print(f"\n  Findings ({len(result.violations)}):")
        for v in result.violations:
            tag = " [deterministic]" if v.source == "deterministic" else ""
            print(f"    •{tag} {v.issue}")
            print(f"      → {v.suggestion}")

    if verbose:
        p = result.pipeline
        print(f"\n  Pipeline:")
        print(f"    Standards checked: {p.standards_checked}/{p.standards_total}")
        print(f"    Preprocess violations: {p.preprocess_violations}")
        print(f"    LLM candidates: {p.llm_candidates}")
        print(f"    Validated: {p.validated_confirmed} confirmed, {p.validated_rejected} rejected")
        print(f"  Latency: {latency:.1f}s")
        print(f"  Tokens: {tokens.input} in / {tokens.output} out")


def print_batch_result(batch: BatchResult, verbose: bool = False) -> None:
    """Pretty-print a batch result to the terminal."""
    color = "\033[32m" if batch.overall_verdict == "pass" else "\033[31m"
    reset = "\033[0m"

    print(f"\n{'='*60}")
    print(f"{color}Batch verdict: {batch.overall_verdict.upper()}{reset}")
    print(f"  {batch.items_passed}/{batch.total_items} items passed")
    if batch.items_failed:
        print(f"  {batch.items_failed}/{batch.total_items} items failed")
    print(f"{'='*60}")

    for ir in batch.item_results:
        label = ir.item.label or ir.item.text[:50]
        v = ir.result.overall_verdict
        icon = "✓" if v == "pass" else "✗"
        c = "\033[32m" if v == "pass" else "\033[31m"

        location = ""
        if ir.item.file_path:
            location = f" ({ir.item.file_path}"
            if ir.item.line_number:
                location += f":{ir.item.line_number}"
            location += ")"

        print(f"\n  {c}{icon}{reset} {label}{location}")

        if ir.result.violations:
            for viol in ir.result.violations:
                tag = " [deterministic]" if viol.source == "deterministic" else ""
                print(f"    •{tag} {viol.issue}")
                print(f"      → {viol.suggestion}")

    if batch.consistency_violations:
        print(f"\n  Consistency issues ({len(batch.consistency_violations)}):")
        for cv in batch.consistency_violations:
            print(f"    • {cv.issue}")
            print(f"      → {cv.suggestion}")
            if cv.items_involved:
                print(f"      Strings: {', '.join(repr(s) for s in cv.items_involved)}")

    if verbose:
        print(f"\n  Total latency: {batch.total_latency:.1f}s")
        print(f"  Total tokens: {batch.total_tokens.input} in / {batch.total_tokens.output} out")


def _load_batch_file(path: str) -> list[ContentItem]:
    """Load content items from a validated batch file.

    Supports:
      - .json: array of strings or array of {text, label?, content_type?} objects
      - .txt: one string per line (blank lines skipped)

    Paths are resolved and validated before the file is opened so unexpected
    inputs (directories, devices, oversized files, unsupported extensions)
    fail fast with a clear error instead of silently feeding the wrong data
    to the pipeline — where it would otherwise be sent to the Anthropic API.

    Raises:
        FileNotFoundError: path does not exist.
        ValueError: path is not a regular file, exceeds the size limit, has
            an unsupported extension, or contains malformed content.
    """
    p = Path(path.strip()).expanduser()

    if not p.exists():
        raise FileNotFoundError(f"Batch file not found: {path}")
    if not p.is_file():
        raise ValueError(f"Batch path is not a regular file: {path}")

    size = p.stat().st_size
    if size > MAX_BATCH_FILE_SIZE:
        raise ValueError(
            f"Batch file too large: {size:,} bytes "
            f"(max {MAX_BATCH_FILE_SIZE:,} bytes)"
        )

    ext = p.suffix.lower()
    if ext == ".json":
        return _parse_json_batch(p)
    if ext == ".txt":
        return _parse_txt_batch(p)
    raise ValueError(
        f"Unsupported batch file extension '{p.suffix}'. "
        f"Supported: {', '.join(SUPPORTED_BATCH_EXTENSIONS)}."
    )


def _parse_json_batch(p: Path) -> list[ContentItem]:
    try:
        with p.open() as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in {p}: {e}") from e

    if not isinstance(data, list):
        raise ValueError(
            f"Batch JSON must be an array of strings or objects, "
            f"got {type(data).__name__}"
        )

    items: list[ContentItem] = []
    for idx, entry in enumerate(data):
        if isinstance(entry, str):
            items.append(ContentItem(text=entry))
        elif isinstance(entry, dict):
            text = entry.get("text", "")
            if not isinstance(text, str):
                raise ValueError(
                    f"Entry {idx}: 'text' must be a string, "
                    f"got {type(text).__name__}"
                )
            try:
                line_number = int(entry.get("line_number", 0) or 0)
            except (TypeError, ValueError):
                line_number = 0
            items.append(ContentItem(
                text=text,
                label=str(entry.get("label", "")),
                file_path=str(entry.get("file_path", "")),
                line_number=line_number,
                content_type=str(entry.get("content_type", "")),
            ))
        else:
            raise ValueError(
                f"Entry {idx} must be a string or object, "
                f"got {type(entry).__name__}"
            )
    return items


def _parse_txt_batch(p: Path) -> list[ContentItem]:
    with p.open() as f:
        lines = [line.strip() for line in f if line.strip()]
    return [ContentItem(text=line) for line in lines]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Check UX copy against content standards."
    )
    parser.add_argument("text", nargs="?", help="Text to check. Omit for interactive mode.")
    parser.add_argument("--type", dest="content_type", help="Override auto-detected content type.")
    parser.add_argument("--interactive", "-i", action="store_true", help="Enter interactive mode.")
    parser.add_argument("--batch", metavar="FILE", help="Check multiple strings from a file (.txt or .json).")
    parser.add_argument("--json", action="store_true", help="Output raw JSON.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show pipeline details.")
    parser.add_argument("--model", default="claude-sonnet-4-20250514", help="Model to use.")
    parser.add_argument("--heuristic", action="store_true", help="Use heuristic classifier.")
    parser.add_argument("--unfiltered", action="store_true", help="Skip filtering and validation.")

    args = parser.parse_args()

    # --- Batch mode ---
    if args.batch:
        try:
            items = _load_batch_file(args.batch)
        except (FileNotFoundError, ValueError) as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        if not items:
            print("No content found in the batch file.")
            return

        print(f"Checking {len(items)} items...")
        batch = check_batch(
            items,
            model=args.model,
            use_llm_classifier=not args.heuristic,
        )

        if args.json:
            print(json.dumps(batch.to_public_envelope(), indent=2))
        else:
            print_batch_result(batch, verbose=args.verbose)
        return

    # --- Single check ---
    def run_check(text: str) -> tuple[CheckResult, float, TokenUsage]:
        if args.unfiltered:
            return check_unfiltered(text, model=args.model)
        return check(
            text,
            content_type=args.content_type,
            model=args.model,
            use_llm_classifier=not args.heuristic,
        )

    if args.interactive or args.text is None:
        print("Content standards checker — interactive mode")
        print("Type a piece of copy to check. Enter 'q' to quit.\n")
        while True:
            try:
                text = input("→ ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nBye.")
                break
            if text.lower() in ("q", "quit", "exit"):
                break
            if not text:
                continue
            try:
                result, latency, tokens = run_check(text)
            except ValueError as e:
                print(f"Error: {e}", file=sys.stderr)
                continue
            if args.json:
                print(json.dumps(result.to_public_envelope(), indent=2))
            else:
                print_result(text, result, latency, tokens, verbose=args.verbose)
            print()
    else:
        try:
            result, latency, tokens = run_check(args.text)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        if args.json:
            print(json.dumps(result.to_public_envelope(), indent=2))
        else:
            print_result(args.text, result, latency, tokens, verbose=args.verbose)


if __name__ == "__main__":
    main()
