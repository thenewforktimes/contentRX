"""Content standards checker — full pipeline.

5-stage pipeline:
  1. Classify — LLM or heuristic content type detection
  2. Filter  — prune standards library to relevant rules for this content type
  3. Scan    — deterministic preprocess (hard rules) + LLM first pass (nuanced rules)
  4. Validate — focused LLM call to confirm or reject each candidate violation
  5. Merge   — combine results, deduplicate, produce final verdict
"""

import json
import time
from pathlib import Path

from preprocess import run_preprocess
from filter_standards import filter_standards, get_content_type_descriptions
from classify import classify_content, classify_content_heuristic
from validate import validate_candidates

STANDARDS_PATH = Path(__file__).parent.parent / "standards" / "standards_library.json"

# Fallback: check local directory (for standalone use)
if not STANDARDS_PATH.exists():
    STANDARDS_PATH = Path(__file__).parent / "standards_library.json"


def load_standards():
    with open(STANDARDS_PATH) as f:
        return json.load(f)


def build_system_prompt(standards_data, content_type=None):
    """Build the system prompt with embedded standards.

    Accepts either the full or filtered standards library — the structure
    is the same. When content_type is provided, it's included in the prompt
    to focus the LLM's evaluation.
    """
    standards_text = ""
    for cat in standards_data["categories"]:
        standards_text += f"\n## {cat['name']}\n"
        for std in cat["standards"]:
            standards_text += f"\n### {std['id']}: {std['rule']}\n"
            standards_text += f"- Correct: {std['correct']}\n"
            standards_text += f"- Incorrect: {std['incorrect']}\n"

    content_type_line = ""
    if content_type:
        content_type_line = f"\nThis content has been classified as: **{content_type}**. Evaluate it with this content type in mind.\n"

    return f"""You are a content standards checker for UX and UI copy. You evaluate whether a piece of copy meets established content standards.
{content_type_line}
Here are the standards you check against:
{standards_text}

## How to evaluate

1. Check the content against the standards listed above, applying these rules:
   - **Only flag clear, unambiguous violations.** If you are less than 90% confident something is a violation, it is not a violation. When in doubt, the content passes.
   - **Read the literal text exactly as written.** Do not assume or hallucinate characters. If you are checking capitalization, verify each word character by character. "Account settings" has a lowercase "s" — do not flag it as title case.
   - **Do not flag content for standards that are only marginally relevant.** A standard must clearly apply to the content type and context.
   - **Do not flag stylistic preferences as violations.** If the content communicates clearly and follows the spirit of the standards, minor stylistic variations are acceptable.
   - **Default verdict is pass.** Content should only fail when there are clear violations that would meaningfully hurt the user experience.

2. For each genuine violation, cite the standard ID, explain what is wrong, and suggest a fix.

3. Give an overall pass/fail verdict. A single minor issue does not automatically mean fail — use judgment about whether the content is good enough to ship.

Respond in this exact JSON format (no markdown, no backticks):
{{
  "content_type": "{content_type or "detected type"}",
  "overall_verdict": "pass" or "fail",
  "violations": [
    {{
      "standard_id": "the standard ID",
      "rule": "the rule text",
      "issue": "what's wrong with the content",
      "suggestion": "how to fix it"
    }}
  ],
  "passes": [
    {{
      "standard_id": "the standard ID",
      "rule": "brief rule description"
    }}
  ],
  "summary": "1-2 sentence plain language summary of the assessment"
}}"""


def check_content(text, content_type_override=None, model="claude-sonnet-4-20250514",
                   use_llm_classifier=True, skip_validation=False, skip_filter=False):
    """Check content against standards using the full pipeline.

    Stages:
      1. Classify content type (LLM or heuristic)
      2. Filter standards to relevant rules
      3. Deterministic preprocess + LLM scan (parallel in concept, sequential in code)
      4. Validation pass on LLM candidates
      5. Merge and produce final result

    Args:
        text: The content to check.
        content_type_override: Skip classification and use this content type.
        model: Claude model for all LLM calls.
        use_llm_classifier: Use LLM for classification (True) or heuristic (False).
        skip_validation: Skip the validation pass (faster, less accurate).
        skip_filter: Skip classification and filtering entirely. Uses all
            standards with no content type context. Useful for testing whether
            the agent knows its own rules against library examples.

    Returns:
        (result_dict, total_latency, total_tokens)
    """
    import anthropic

    standards_data = load_standards()
    total_latency = 0
    total_tokens = {"input": 0, "output": 0}

    if skip_filter:
        # ── Library mode: all standards, no content type context ────────
        content_type = "unfiltered"
        filtered = standards_data  # use full library
        active_notes = []
    else:
        # ── Stage 1: Classify ──────────────────────────────────────────
        if content_type_override:
            content_type = content_type_override
        elif use_llm_classifier:
            content_types = get_content_type_descriptions(standards_data)
            content_type, cls_latency, cls_tokens = classify_content(
                text, content_types=content_types, model=model, use_llm=True
            )
            total_latency += cls_latency
            total_tokens["input"] += cls_tokens["input"]
            total_tokens["output"] += cls_tokens["output"]
        else:
            content_type = classify_content_heuristic(text)

        # ── Stage 2: Filter ────────────────────────────────────────────
        filtered = filter_standards(standards_data, content_type)
        active_notes = filtered.get("active_notes", [])

    # ── Stage 3a: Deterministic preprocess ─────────────────────────────
    preprocess_violations = run_preprocess(text)
    preprocess_ids = {v["standard_id"] for v in preprocess_violations}

    # ── Stage 3b: LLM scan ────────────────────────────────────────────
    client = anthropic.Anthropic()
    prompt_content_type = None if content_type == "unfiltered" else content_type
    system_prompt = build_system_prompt(filtered, content_type=prompt_content_type)

    if prompt_content_type:
        user_message = f'Check this {content_type} content against the standards:\n\n"{text}"'
    else:
        user_message = f'Check this content against the standards:\n\n"{text}"'

    scan_start = time.time()
    response = client.messages.create(
        model=model,
        max_tokens=2000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    scan_latency = time.time() - scan_start
    total_latency += scan_latency

    total_tokens["input"] += response.usage.input_tokens
    total_tokens["output"] += response.usage.output_tokens

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    try:
        scan_result = json.loads(raw)
    except json.JSONDecodeError:
        scan_result = {
            "content_type": content_type,
            "overall_verdict": "error",
            "violations": [],
            "passes": [],
            "summary": f"Failed to parse response: {raw[:200]}",
            "raw_response": raw,
        }

    # Collect LLM candidate violations (excluding those already caught by preprocess)
    llm_candidates = [
        v for v in scan_result.get("violations", [])
        if v.get("standard_id") not in preprocess_ids
    ]

    # ── Stage 4: Validation pass ───────────────────────────────────────
    if skip_validation or not llm_candidates:
        confirmed_violations = llm_candidates
        rejected_violations = []
    else:
        confirmed_violations, rejected_violations, val_latency, val_tokens = (
            validate_candidates(
                text, content_type, llm_candidates,
                active_notes=active_notes, model=model,
            )
        )
        total_latency += val_latency
        total_tokens["input"] += val_tokens["input"]
        total_tokens["output"] += val_tokens["output"]

    # ── Stage 5: Merge ─────────────────────────────────────────────────
    # Deterministic violations are authoritative — always included
    final_violations = list(preprocess_violations) + confirmed_violations

    # Remove standards from passes if they were flagged
    flagged_ids = {v["standard_id"] for v in final_violations}
    final_passes = [
        p for p in scan_result.get("passes", [])
        if p.get("standard_id") not in flagged_ids
    ]

    # Determine verdict
    if final_violations:
        verdict = "fail"
    else:
        verdict = "pass"

    result = {
        "content_type": content_type,
        "overall_verdict": verdict,
        "violations": final_violations,
        "passes": final_passes,
        "summary": scan_result.get("summary", ""),
        "pipeline": {
            "standards_checked": filtered.get("filtered_count", filtered.get("total_standards", "all")),
            "standards_total": filtered.get("total_count", filtered.get("total_standards", "?")),
            "preprocess_violations": len(preprocess_violations),
            "llm_candidates": len(llm_candidates),
            "validated_confirmed": len(confirmed_violations),
            "validated_rejected": len(rejected_violations),
        },
    }

    return result, total_latency, total_tokens


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def print_result(text, result, latency, tokens, verbose=False):
    """Pretty-print a check result to the terminal."""
    verdict = result.get("overall_verdict", "unknown")
    icon = "✓" if verdict == "pass" else "✗"
    color_start = "\033[32m" if verdict == "pass" else "\033[31m"
    color_end = "\033[0m"

    print(f"\n{color_start}{icon} {verdict.upper()}{color_end}")
    print(f"  Content type: {result.get('content_type', 'unknown')}")
    print(f"  {result.get('summary', '')}")

    violations = result.get("violations", [])
    if violations:
        print(f"\n  Violations ({len(violations)}):")
        for v in violations:
            source_tag = " [deterministic]" if v.get("source") == "deterministic" else ""
            print(f"    [{v['standard_id']}]{source_tag} {v['issue']}")
            print(f"      → {v['suggestion']}")

    if verbose:
        pipeline = result.get("pipeline", {})
        print(f"\n  Pipeline:")
        print(f"    Standards checked: {pipeline.get('standards_checked', '?')}/{pipeline.get('standards_total', '?')}")
        print(f"    Preprocess violations: {pipeline.get('preprocess_violations', 0)}")
        print(f"    LLM candidates: {pipeline.get('llm_candidates', 0)}")
        print(f"    Validated: {pipeline.get('validated_confirmed', 0)} confirmed, {pipeline.get('validated_rejected', 0)} rejected")
        print(f"  Latency: {latency:.1f}s")
        print(f"  Tokens: {tokens['input']} in / {tokens['output']} out")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Check UX copy against content standards."
    )
    parser.add_argument(
        "text",
        nargs="?",
        help="Text to check. Omit for interactive mode.",
    )
    parser.add_argument(
        "--type",
        dest="content_type",
        help="Override auto-detected content type.",
    )
    parser.add_argument(
        "--interactive", "-i",
        action="store_true",
        help="Enter interactive mode (check multiple strings).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON instead of formatted text.",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show pipeline details, latency, and token usage.",
    )
    parser.add_argument(
        "--model",
        default="claude-sonnet-4-20250514",
        help="Model to use (default: claude-sonnet-4-20250514).",
    )
    parser.add_argument(
        "--heuristic",
        action="store_true",
        help="Use heuristic classifier instead of LLM (faster, less accurate).",
    )
    parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="Skip the validation pass (faster, may have more false positives).",
    )

    args = parser.parse_args()

    check_kwargs = {
        "content_type_override": args.content_type,
        "model": args.model,
        "use_llm_classifier": not args.heuristic,
        "skip_validation": args.skip_validation,
    }

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
            result, latency, tokens = check_content(text, **check_kwargs)
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print_result(text, result, latency, tokens, verbose=args.verbose)
            print()
    else:
        result, latency, tokens = check_content(args.text, **check_kwargs)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print_result(args.text, result, latency, tokens, verbose=args.verbose)


if __name__ == "__main__":
    main()
