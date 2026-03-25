"""Validation pass for the content standards checker.

The second LLM call in the pipeline. Takes candidate violations from the scan
phase and makes focused yes/no judgments on each one. Injects content_type_notes
when available to give the model context-specific evaluation guidance.

This is where "Your changes are saved" stops getting flagged for VT-01 — the
validator sees "this is a confirmation, and VT-01 says passive voice is acceptable
in confirmations" and clears the candidate.
"""

import json
import time


def _build_validation_prompt(content_type, active_notes):
    """Build the system prompt for the validation pass."""
    notes_text = ""
    if active_notes:
        notes_text = "\n\n## Content type notes\n\nThese notes provide additional context for evaluating specific standards against this content type:\n"
        for note in active_notes:
            notes_text += f"\n- **{note['standard_id']}**: {note['note']}"

    return f"""You are a content standards validator. Your job is to review candidate violations and decide whether each one is a genuine violation in context.

The content being checked was classified as: **{content_type}**
{notes_text}

For each candidate violation, you will receive:
- The standard ID and rule text
- The correct and incorrect examples from the standards library
- The issue that was flagged
- The original content

For each candidate, respond with ONLY "confirm" or "reject":
- **confirm**: This is a genuine violation that should be reported.
- **reject**: This is a false positive. The content is acceptable in this context.

Apply these principles:
- If a content type note provides specific guidance for this standard, follow it.
- If the content is borderline, reject. The bar for confirming a violation should be high.
- Consider whether the flagged issue actually hurts the user experience for this specific content type.
- A confirmation does not need perfect copy — it needs to communicate the outcome clearly.
- An error message has different requirements than a tooltip or long-form documentation.

Respond in this exact JSON format (no markdown, no backticks):
{{
  "validations": [
    {{
      "standard_id": "the standard ID",
      "verdict": "confirm" or "reject",
      "reason": "1 sentence explaining why"
    }}
  ]
}}"""


def validate_candidates(text, content_type, candidates, active_notes=None,
                        model="claude-sonnet-4-20250514"):
    """Validate candidate violations with a focused LLM call.

    Args:
        text: The original content being checked.
        content_type: The classified content type.
        candidates: List of violation dicts from the scan phase.
        active_notes: List of {standard_id, note} dicts from the filter.
        model: Claude model to use.

    Returns:
        (confirmed_violations, rejected_violations, latency, tokens)
    """
    if not candidates:
        return [], [], 0, {"input": 0, "output": 0}

    import anthropic

    active_notes = active_notes or []

    system_prompt = _build_validation_prompt(content_type, active_notes)

    # Build the user message with each candidate
    candidate_text = f'Original content ({content_type}):\n"{text}"\n\nCandidate violations to validate:\n'
    for i, v in enumerate(candidates, 1):
        candidate_text += f"\n{i}. [{v['standard_id']}] {v.get('rule', '')}\n"
        candidate_text += f"   Issue: {v.get('issue', '')}\n"
        if v.get("suggestion"):
            candidate_text += f"   Suggested fix: {v['suggestion']}\n"

    client = anthropic.Anthropic()

    start = time.time()
    response = client.messages.create(
        model=model,
        max_tokens=1000,
        system=system_prompt,
        messages=[{"role": "user", "content": candidate_text}],
    )
    latency = time.time() - start

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    tokens = {
        "input": response.usage.input_tokens,
        "output": response.usage.output_tokens,
    }

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        # If we can't parse the response, confirm all candidates (safe default)
        return candidates, [], latency, tokens

    # Map validation verdicts back to candidates
    validation_map = {}
    for v in result.get("validations", []):
        validation_map[v.get("standard_id")] = v.get("verdict", "confirm")

    confirmed = []
    rejected = []

    for candidate in candidates:
        std_id = candidate.get("standard_id")
        verdict = validation_map.get(std_id, "confirm")

        if verdict == "reject":
            # Add rejection reason if available
            for v in result.get("validations", []):
                if v.get("standard_id") == std_id:
                    candidate["rejection_reason"] = v.get("reason", "")
                    break
            rejected.append(candidate)
        else:
            confirmed.append(candidate)

    return confirmed, rejected, latency, tokens


# ---------------------------------------------------------------------------
# Self-test (structural only — no API calls)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Running validation pass self-tests (structural only)...\n")
    counts = {"passed": 0, "failed": 0}

    def test(name, actual, expected):
        ok = actual == expected
        icon = "✓" if ok else "✗"
        color = "\033[32m" if ok else "\033[31m"
        print(f"  {color}{icon}\033[0m {name}")
        if not ok:
            print(f"    expected: {expected}")
            print(f"    actual:   {actual}")
            counts["failed"] += 1
        else:
            counts["passed"] += 1

    # --- Prompt building ---
    print("Prompt building")
    prompt = _build_validation_prompt("confirmation", [
        {"standard_id": "VT-01", "note": "Passive voice is acceptable."}
    ])
    test("prompt includes content type", "confirmation" in prompt, True)
    test("prompt includes VT-01 note", "Passive voice is acceptable" in prompt, True)
    test("prompt includes confirm/reject", "confirm" in prompt and "reject" in prompt, True)

    prompt_no_notes = _build_validation_prompt("button_cta", [])
    test("prompt without notes excludes notes section", "Content type notes" not in prompt_no_notes, True)

    # --- Empty candidates returns empty ---
    print("\nEmpty candidates")
    confirmed, rejected, latency, tokens = validate_candidates(
        "test", "button_cta", [], model="test"
    )
    test("empty candidates returns empty confirmed", confirmed, [])
    test("empty candidates returns empty rejected", rejected, [])
    test("empty candidates latency is 0", latency, 0)
    test("empty candidates tokens are empty", tokens, {"input": 0, "output": 0})

    print(f"\n{'='*40}")
    print(f"Passed: {counts['passed']}  Failed: {counts['failed']}")
    if counts["failed"] == 0:
        print("\033[32mAll tests passed.\033[0m")
    else:
        print(f"\033[31m{counts['failed']} test(s) failed.\033[0m")
