"""Content standards checker agent.

Checks copy against a structured standards library using Claude as the reasoning engine.
"""

import json
import time
from pathlib import Path

STANDARDS_PATH = Path(__file__).parent.parent / "standards" / "standards_library.json"

# Fallback: check local directory (for standalone use)
if not STANDARDS_PATH.exists():
    STANDARDS_PATH = Path(__file__).parent / "standards_library.json"


def load_standards():
    with open(STANDARDS_PATH) as f:
        return json.load(f)


def detect_content_type(text):
    """Auto-detect what type of content the user submitted."""
    text_lower = text.lower().strip()
    length = len(text_lower.split())

    if length <= 5 and any(w in text_lower for w in [
        "click", "tap", "save", "delete", "create", "submit", "cancel",
        "confirm", "sign", "log", "get started", "try", "upgrade"
    ]):
        return "button_cta"
    if length <= 15 and any(w in text_lower for w in [
        "error", "fail", "couldn't", "can't", "unable", "went wrong", "oops"
    ]):
        return "error_message"
    if length <= 20 and ("?" not in text_lower) and any(w in text_lower for w in [
        "success", "done", "complete", "ready", "saved", "sent",
        "created", "updated", "deleted"
    ]):
        return "confirmation"
    if length <= 30 and "?" in text_lower:
        return "tooltip_microcopy"
    if length <= 8:
        return "ui_label"
    if length <= 40:
        return "short_ui_copy"
    return "long_form_copy"


def build_system_prompt(standards_data):
    """Build the system prompt with embedded standards."""
    standards_text = ""
    for cat in standards_data["categories"]:
        standards_text += f"\n## {cat['name']}\n"
        for std in cat["standards"]:
            standards_text += f"\n### {std['id']}: {std['rule']}\n"
            standards_text += f"- Correct: {std['correct']}\n"
            standards_text += f"- Incorrect: {std['incorrect']}\n"

    return f"""You are a content standards checker for UX and UI copy. You evaluate whether a piece of copy meets established content standards.

Here are the standards you check against:
{standards_text}

## How to evaluate

1. Identify the content type (button/CTA, error message, confirmation, tooltip, UI label, short UI copy, or long-form copy).

2. Check the content against the standards, but apply these rules:
   - **Only flag clear, unambiguous violations.** If you are less than 90% confident something is a violation, it is not a violation. When in doubt, the content passes.
   - **Read the literal text exactly as written.** Do not assume or hallucinate characters. If you are checking capitalization, verify each word character by character. "Account settings" has a lowercase "s" — do not flag it as title case.
   - **Do not flag content for standards that are only marginally relevant.** A standard must clearly apply to the content type and context. Not every standard applies to every piece of copy.
   - **Do not flag stylistic preferences as violations.** If the content communicates clearly and follows the spirit of the standards, minor stylistic variations are acceptable.
   - **Default verdict is pass.** Content should only fail when there are clear violations that would meaningfully hurt the user experience.

3. For each genuine violation, cite the standard ID, explain what is wrong, and suggest a fix.

4. Give an overall pass/fail verdict. A single minor issue does not automatically mean fail — use judgment about whether the content is good enough to ship.

Respond in this exact JSON format (no markdown, no backticks):
{{
  "content_type": "detected type",
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


def check_content(text, content_type_override=None, model="claude-sonnet-4-20250514"):
    """Check content against standards.

    Returns (result_dict, latency_seconds, token_counts).
    """
    import anthropic

    standards_data = load_standards()
    detected_type = content_type_override or detect_content_type(text)

    client = anthropic.Anthropic()
    system_prompt = build_system_prompt(standards_data)

    user_message = f'Check this {detected_type} content against the standards:\n\n"{text}"'

    start = time.time()
    response = client.messages.create(
        model=model,
        max_tokens=2000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    latency = time.time() - start

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {
            "content_type": detected_type,
            "overall_verdict": "error",
            "violations": [],
            "passes": [],
            "summary": f"Failed to parse response: {raw[:200]}",
            "raw_response": raw,
        }

    tokens = {
        "input": response.usage.input_tokens,
        "output": response.usage.output_tokens,
    }

    return result, latency, tokens


# ---------------------------------------------------------------------------
# CLI entry point
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
            print(f"    [{v['standard_id']}] {v['issue']}")
            print(f"      → {v['suggestion']}")

    if verbose:
        print(f"\n  Latency: {latency:.1f}s")
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
        help="Show latency and token usage.",
    )
    parser.add_argument(
        "--model",
        default="claude-sonnet-4-20250514",
        help="Model to use (default: claude-sonnet-4-20250514).",
    )

    args = parser.parse_args()

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
            result, latency, tokens = check_content(
                text,
                content_type_override=args.content_type,
                model=args.model,
            )
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print_result(text, result, latency, tokens, verbose=args.verbose)
            print()
    else:
        result, latency, tokens = check_content(
            args.text,
            content_type_override=args.content_type,
            model=args.model,
        )
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print_result(args.text, result, latency, tokens, verbose=args.verbose)


if __name__ == "__main__":
    main()
