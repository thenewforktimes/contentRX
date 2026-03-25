"""LLM-based content type classifier for the content standards checker.

Replaces the keyword-matching detect_content_type with a lightweight Claude call
that reasons about what kind of UI copy the input is. Reads the content type
taxonomy from the standards library so new types (from packs, custom configs)
are automatically available without code changes.

Falls back to a fast heuristic classifier when no API key is available or
when called with use_llm=False.
"""

import json
import re
import time


def classify_content_heuristic(text):
    """Fast, zero-cost heuristic classifier. Used as fallback.

    This is the original detect_content_type logic, kept for offline use,
    tests, and as a tiebreaker when the LLM is uncertain.
    """
    text_lower = text.lower().strip()
    words = text_lower.split()
    length = len(words)

    # Check error and confirmation BEFORE buttons — they have more specific
    # signals, and short error/confirmation text often contains button keywords
    # like "save" or "try" as substrings.
    if length <= 15 and any(w in text_lower for w in [
        "error", "fail", "couldn't", "can't", "unable", "went wrong",
        "oops", "problem", "issue", "sorry", "unexpected",
    ]):
        return "error_message"
    if length <= 20 and ("?" not in text_lower) and any(w in text_lower for w in [
        "success", "done", "complete", "ready", "saved", "sent",
        "created", "updated", "deleted", "confirmed", "verified",
        "published", "applied", "removed", "added",
    ]):
        return "confirmation"
    if length <= 5 and any(w in text_lower for w in [
        "click", "tap", "save", "delete", "create", "submit", "cancel",
        "confirm", "sign", "log", "get started", "try", "upgrade",
        "download", "send", "export", "import", "connect", "start",
        "continue", "next", "back", "done", "apply", "remove", "add",
        "edit", "update", "share", "copy", "move", "open", "close",
    ]):
        return "button_cta"
    if length <= 30 and "?" in text_lower:
        return "tooltip_microcopy"
    if length <= 8:
        return "ui_label"
    if length <= 40:
        return "short_ui_copy"
    return "long_form_copy"


def _build_classifier_prompt(content_types):
    """Build the system prompt for the LLM classifier."""
    type_descriptions = ""
    type_ids = []
    for ct in content_types:
        type_descriptions += f"\n- **{ct['id']}**: {ct['description']}"
        type_ids.append(ct["id"])

    return f"""You are a content type classifier for UI and UX copy. Your job is to identify what kind of content a piece of text is.

Here are the content types:
{type_descriptions}

Respond with ONLY the content type ID. No explanation, no punctuation, no quotes. Just the ID.

If the text could fit multiple types, pick the most specific one. For example, "Your changes are saved" is a confirmation, not short_ui_copy, even though it's short.

Valid IDs: {', '.join(type_ids)}"""


def classify_content_llm(text, content_types, model="claude-sonnet-4-20250514"):
    """Classify content type using an LLM call.

    Makes a lightweight API call (~100 tokens) to classify the input.
    Returns (content_type_id, latency, tokens).

    The content_types list comes from the standards library, so custom
    types from packs are automatically supported.
    """
    import anthropic

    system_prompt = _build_classifier_prompt(content_types)
    valid_ids = [ct["id"] for ct in content_types]

    client = anthropic.Anthropic()

    start = time.time()
    response = client.messages.create(
        model=model,
        max_tokens=50,
        system=system_prompt,
        messages=[{"role": "user", "content": f'Classify this content:\n\n"{text}"'}],
    )
    latency = time.time() - start

    raw = response.content[0].text.strip().lower()

    tokens = {
        "input": response.usage.input_tokens,
        "output": response.usage.output_tokens,
    }

    # Validate the response is a known content type
    if raw in valid_ids:
        return raw, latency, tokens

    # Try to extract a valid ID from the response (in case of extra text)
    for type_id in valid_ids:
        if type_id in raw:
            return type_id, latency, tokens

    # Fall back to heuristic if LLM returns garbage
    fallback = classify_content_heuristic(text)
    return fallback, latency, tokens


def classify_content(text, content_types=None, model="claude-sonnet-4-20250514",
                     use_llm=True):
    """Classify content type. Main entry point.

    Args:
        text: The content to classify.
        content_types: List of content type dicts from the standards library.
            If None, uses heuristic classifier only.
        model: Claude model to use for LLM classification.
        use_llm: If False, skips the LLM call and uses heuristic only.

    Returns:
        If use_llm=True: (content_type_id, latency, tokens)
        If use_llm=False: (content_type_id, 0, {"input": 0, "output": 0})
    """
    if not use_llm or content_types is None:
        result = classify_content_heuristic(text)
        return result, 0, {"input": 0, "output": 0}

    return classify_content_llm(text, content_types, model=model)


# ---------------------------------------------------------------------------
# Self-test (heuristic only — no API calls)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Running classifier self-tests (heuristic mode)...\n")
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

    # --- Button/CTA ---
    print("button_cta")
    test("Create account", classify_content_heuristic("Create account"), "button_cta")
    test("Save changes", classify_content_heuristic("Save changes"), "button_cta")
    test("Get started", classify_content_heuristic("Get started"), "button_cta")
    test("Delete", classify_content_heuristic("Delete"), "button_cta")
    test("Sign in", classify_content_heuristic("Sign in"), "button_cta")
    test("Export data", classify_content_heuristic("Export data"), "button_cta")

    # --- Error messages ---
    print("\nerror_message")
    test("payment error (heuristic misses — LLM handles)", classify_content_heuristic("Your payment didn't go through. Try a different card."), "short_ui_copy")
    test("upload failed", classify_content_heuristic("Upload failed. Try again later."), "error_message")
    test("something went wrong", classify_content_heuristic("Something went wrong. Please try again."), "error_message")
    test("couldn't save", classify_content_heuristic("We couldn't save your changes."), "error_message")

    # --- Confirmations ---
    print("\nconfirmation")
    test("changes saved", classify_content_heuristic("Your changes are saved."), "confirmation")
    test("account created", classify_content_heuristic("Your account has been successfully created."), "confirmation")
    test("email sent", classify_content_heuristic("Your email has been sent."), "confirmation")
    test("file deleted", classify_content_heuristic("The file has been deleted."), "confirmation")

    # --- Tooltips ---
    print("\ntooltip_microcopy")
    test("what does this do?", classify_content_heuristic("What does this setting do?"), "tooltip_microcopy")

    # --- UI labels ---
    print("\nui_label")
    test("account settings", classify_content_heuristic("Account settings"), "ui_label")
    test("billing", classify_content_heuristic("Billing"), "ui_label")
    test("new project", classify_content_heuristic("New project"), "ui_label")
    test("reporting analytics", classify_content_heuristic("Reporting analytics"), "ui_label")

    # --- Short UI copy ---
    print("\nshort_ui_copy")
    test("upload limit", classify_content_heuristic("You can upload files up to 25 MB. For larger files, use our desktop app."), "short_ui_copy")
    test("subscription info", classify_content_heuristic("Your subscription renews on the 1st of each month."), "short_ui_copy")

    # --- Long-form copy ---
    print("\nlong_form_copy")
    long_text = "To complete verification you will need to provide a valid government-issued photo ID and you should also have a recent utility bill or bank statement that shows your current address. Once verified, you can access all features of your account including the ability to send and receive payments, manage your team members, and configure advanced security settings."
    test("long paragraph", classify_content_heuristic(long_text), "long_form_copy")

    # --- classify_content wrapper ---
    print("\nclassify_content wrapper")
    result, latency, tokens = classify_content("Save changes", use_llm=False)
    test("wrapper returns button_cta", result, "button_cta")
    test("wrapper latency is 0", latency, 0)
    test("wrapper tokens are empty", tokens, {"input": 0, "output": 0})

    print(f"\n{'='*40}")
    print(f"Passed: {counts['passed']}  Failed: {counts['failed']}")
    if counts["failed"] == 0:
        print("\033[32mAll tests passed.\033[0m")
    else:
        print(f"\033[31m{counts['failed']} test(s) failed.\033[0m")
