"""Deterministic pre-processing layer for mechanical content standards.

Runs regex and pattern-matching checks before the LLM call. Catches binary,
character-level violations that the model consistently misses — Oxford commas,
spelled-out numbers, ampersands, and date formats.

Each check function returns a list of violation dicts matching the same schema
as the LLM's output, plus a "source": "deterministic" field.
"""

import re


# ---------------------------------------------------------------------------
# GRM-01: Oxford comma
# ---------------------------------------------------------------------------

# Known conjunctions that join the final item in a list
_LIST_CONJUNCTIONS = r"\b(and|or)\b"

def check_oxford_comma(text):
    """Flag lists of 3+ items missing the serial comma before 'and'/'or'.

    Strategy: find 'and'/'or' in the sentence, look at the text before it.
    If the text before contains at least one comma (indicating a list) and
    does NOT end with a comma right before the conjunction, the serial
    comma is missing.

    Edge cases handled:
    - Two-item lists ("orders and returns") — no comma before, not flagged
    - Compound sentences with comma ("I ordered pizza, and she ordered pasta")
      — handled by checking the last segment looks like a list item
    - Already correct ("x, y, and z") — comma before "and", not flagged
    """
    violations = []

    sentences = re.split(r'(?<=[.!?])\s+', text)

    for sentence in sentences:
        # Find each 'and' or 'or' that could be joining the last item in a list
        for match in re.finditer(r'\s+(and|or)\s+', sentence, re.IGNORECASE):
            conj = match.group(1)
            before = sentence[:match.start()]

            # Must have at least one comma before the conjunction
            if ',' not in before:
                continue

            # Check if there's a comma immediately before the conjunction
            # (allowing whitespace). If so, serial comma is present — skip.
            before_stripped = before.rstrip()
            if before_stripped.endswith(','):
                continue

            # Split on commas to count list segments
            segments = before.split(',')
            if len(segments) < 2:
                continue

            # The last segment (between the last comma and the conjunction)
            # should look like a list item — short phrase, not a full clause
            last_segment = segments[-1].strip()
            if not last_segment:
                continue

            # Heuristic: list items are typically short (1-6 words).
            # Full clauses tend to be longer and contain their own subject+verb.
            word_count = len(last_segment.split())
            if word_count > 6:
                continue

            violations.append({
                "standard_id": "GRM-01",
                "rule": "Use the serial comma (Oxford comma) in lists of three or more items.",
                "issue": f"Missing Oxford comma before '{conj}' in a list of 3 or more items.",
                "suggestion": f"Add a comma before '{conj}': '...{last_segment}, {conj} ...'",
                "source": "deterministic",
            })
            break  # One flag per sentence is enough

    return violations


# ---------------------------------------------------------------------------
# GRM-04: Ampersands
# ---------------------------------------------------------------------------

# Brands that legitimately use & in their name
_BRAND_AMPERSANDS = {
    "at&t", "h&m", "m&m", "m&ms", "m&m's", "p&g", "s&p", "a&w", "a&e",
    "b&h", "d&g", "r&d", "h&r", "c&a", "t&c",  # T&C is borderline but common
    "barnes & noble", "bed bath & beyond", "ben & jerry", "ben & jerry's",
    "dolce & gabbana", "ernst & young", "johnson & johnson",
    "procter & gamble", "simon & schuster", "tiffany & co",
    "arm & hammer", "jack & jones",
}


def check_ampersand(text):
    """Flag ampersands (&) that aren't part of a known brand name.

    The standard (GRM-04) says: don't use ampersands in copy unless they are
    part of a brand name. This checks for & and exempts known brands.
    """
    violations = []

    if "&" not in text:
        return violations

    # Check if & appears in a known brand context
    text_lower = text.lower()
    for brand in _BRAND_AMPERSANDS:
        if brand in text_lower:
            # Remove the brand match to avoid flagging it
            text_lower = text_lower.replace(brand, "")

    # If there are still ampersands left after removing brands, flag them
    if "&" in text_lower:
        # Find the actual position in original text for the suggestion
        violations.append({
            "standard_id": "GRM-04",
            "rule": "Don't use ampersands in copy unless they are part of a brand name.",
            "issue": "Contains an ampersand (&) that is not part of a recognized brand name.",
            "suggestion": "Replace '&' with 'and'.",
            "source": "deterministic",
        })

    return violations


# ---------------------------------------------------------------------------
# GRM-05: Numerals vs. spelled-out numbers
# ---------------------------------------------------------------------------

# Number words to flag in body copy (when not at sentence start)
_NUMBER_WORDS = {
    "zero", "one", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
    "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
    "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "million", "billion",
}

# Words that look like numbers but aren't counts in UI copy
_NUMBER_EXCEPTIONS = {
    "one",  # "one" is often used as a pronoun ("pick one", "one of your")
    "once", "none", "anyone", "someone", "everyone", "no one",
}

# Compound number words (twenty-one through ninety-nine)
_COMPOUND_NUMBER_PATTERN = re.compile(
    r"\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)"
    r"[- ](one|two|three|four|five|six|seven|eight|nine)\b",
    re.IGNORECASE
)


def check_numerals(text):
    """Flag spelled-out numbers that should be numerals per GRM-05.

    Rules:
    - Use numerals for numbers in body copy
    - Exception: spell out a number when it begins a sentence

    This flags "two new notifications" but passes "Twelve users are online."
    (because "Twelve" starts the sentence).
    """
    violations = []
    found_spelled_out = []

    # Split into sentences
    sentences = re.split(r'(?<=[.!?])\s+', text)

    for sentence in sentences:
        words = sentence.split()
        if not words:
            continue

        # Identify the first "real" word (skip leading punctuation/quotes)
        first_word_idx = 0
        for i, w in enumerate(words):
            stripped = w.lstrip('"\'""''([')
            if stripped:
                first_word_idx = i
                break

        for i, word in enumerate(words):
            # Clean the word of surrounding punctuation for matching
            clean = word.strip('.,;:!?\'"()[]{}""''—–-').lower()

            # Skip if this word starts the sentence (exception in the rule)
            if i == first_word_idx:
                continue

            # Skip known non-count uses of "one"
            if clean in _NUMBER_EXCEPTIONS:
                continue

            # Check standalone number words
            if clean in _NUMBER_WORDS and clean not in _NUMBER_EXCEPTIONS:
                found_spelled_out.append(word.strip('.,;:!?'))

        # Check compound numbers (twenty-one, etc.)
        # Exclude sentence-start position
        if len(sentence) > 0:
            for match in _COMPOUND_NUMBER_PATTERN.finditer(sentence):
                # Check if this match starts the sentence
                if match.start() == 0:
                    continue
                # Check if it's at sentence start after whitespace
                before = sentence[:match.start()].strip()
                if not before:
                    continue
                found_spelled_out.append(match.group(0))

    if found_spelled_out:
        examples = ", ".join(f"'{w}'" for w in found_spelled_out[:3])
        violations.append({
            "standard_id": "GRM-05",
            "rule": "Use numerals for numbers in body copy. Spell out a number only when it begins a sentence.",
            "issue": f"Spelled-out number(s) found in body copy: {examples}. Use numerals instead.",
            "suggestion": f"Replace spelled-out numbers with numerals (e.g., 'two' → '2', 'five' → '5'). Numbers at the start of a sentence can stay spelled out.",
            "source": "deterministic",
        })

    return violations


# ---------------------------------------------------------------------------
# CON-03: Date format
# ---------------------------------------------------------------------------

# Numeric date patterns: M/D/YY, MM/DD/YYYY, M-D-YY, etc.
_NUMERIC_DATE_PATTERN = re.compile(
    r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b"
)


def check_date_format(text):
    """Flag numeric-only date formats that should spell out the month.

    Catches patterns like 3/16/26, 03/16/2026, 3-16-26, etc.
    The standard (CON-03) says to spell out the month to avoid ambiguity.
    """
    violations = []

    matches = _NUMERIC_DATE_PATTERN.findall(text)
    if matches:
        # Show the first match as an example
        example = f"{matches[0][0]}/{matches[0][1]}/{matches[0][2]}"
        violations.append({
            "standard_id": "CON-03",
            "rule": "Use consistent date and time formats. Spell out the month to avoid ambiguity.",
            "issue": f"Numeric date format found ('{example}'). Spelled-out months avoid ambiguity across locales.",
            "suggestion": "Use a format like 'March 16, 2026' instead of numeric dates.",
            "source": "deterministic",
        })

    return violations


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_preprocess(text):
    """Run all deterministic checks. Returns a list of violation dicts.

    Each violation has the same schema as the LLM output plus "source": "deterministic".
    """
    violations = []
    violations.extend(check_oxford_comma(text))
    violations.extend(check_ampersand(text))
    violations.extend(check_numerals(text))
    violations.extend(check_date_format(text))
    return violations


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Running preprocess self-tests...\n")
    counts = {"passed": 0, "failed": 0}

    def test(name, result, expected_ids):
        actual_ids = sorted(set(v["standard_id"] for v in result))
        expected = sorted(set(expected_ids))
        ok = actual_ids == expected
        icon = "✓" if ok else "✗"
        color = "\033[32m" if ok else "\033[31m"
        print(f"  {color}{icon}\033[0m {name}")
        if not ok:
            print(f"    expected: {expected}")
            print(f"    actual:   {actual_ids}")
            for v in result:
                print(f"    → [{v['standard_id']}] {v['issue']}")
            counts["failed"] += 1
        else:
            counts["passed"] += 1

    # --- GRM-01: Oxford comma ---
    print("GRM-01: Oxford comma")
    test(
        "missing oxford comma",
        check_oxford_comma("You can track orders, manage returns and contact support from your account page."),
        ["GRM-01"],
    )
    test(
        "oxford comma present",
        check_oxford_comma("You can track orders, manage returns, and contact support from your account page."),
        [],
    )
    test(
        "two items — no comma needed",
        check_oxford_comma("You can track orders and manage returns from your account page."),
        [],
    )
    test(
        "missing oxford comma with 'or'",
        check_oxford_comma("Choose between red, blue or green."),
        ["GRM-01"],
    )
    test(
        "library example — correct",
        check_oxford_comma("You can send emails, build landing pages, and manage contacts."),
        [],
    )
    test(
        "library example — incorrect",
        check_oxford_comma("You can send emails, build landing pages and manage contacts."),
        ["GRM-01"],
    )

    # --- GRM-04: Ampersands ---
    print("\nGRM-04: Ampersands")
    test(
        "ampersand in copy",
        check_ampersand("Reporting & analytics"),
        ["GRM-04"],
    )
    test(
        "brand ampersand — AT&T",
        check_ampersand("Powered by AT&T"),
        [],
    )
    test(
        "brand ampersand — H&M",
        check_ampersand("Shop the H&M collection"),
        [],
    )
    test(
        "library example — correct",
        check_ampersand("Terms and conditions"),
        [],
    )
    test(
        "library example — incorrect",
        check_ampersand("Terms & conditions"),
        ["GRM-04"],
    )

    # --- GRM-05: Numerals ---
    print("\nGRM-05: Numerals vs. spelled-out")
    test(
        "spelled-out numbers in body",
        check_numerals("You have two new notifications and five pending requests."),
        ["GRM-05"],
    )
    test(
        "number starts sentence — exception",
        check_numerals("Twelve users are currently online."),
        [],
    )
    test(
        "numerals used correctly",
        check_numerals("You have 3 invitations and 12 unread messages."),
        [],
    )
    test(
        "'one' as pronoun — should not flag",
        check_numerals("Pick one that works for you."),
        [],
    )
    test(
        "library example — correct",
        check_numerals("You have 3 invitations and 12 unread messages."),
        [],
    )
    test(
        "library example — incorrect",
        check_numerals("You have three invitations and twelve unread messages."),
        ["GRM-05"],
    )

    # --- CON-03: Date format ---
    print("\nCON-03: Date format")
    test(
        "numeric date",
        check_date_format("Your trial expires on 3/16/26."),
        ["CON-03"],
    )
    test(
        "spelled-out date — pass",
        check_date_format("Your trial expires on March 16, 2026."),
        [],
    )
    test(
        "library example — incorrect",
        check_date_format("3/16/26"),
        ["CON-03"],
    )
    test(
        "no date in text",
        check_date_format("Your order has shipped."),
        [],
    )

    # --- Full pipeline ---
    print("\nFull pipeline (run_preprocess)")
    test(
        "multiple violations",
        run_preprocess("You can edit, preview & publish content on 3/16/26."),
        ["GRM-04", "CON-03"],
    )
    test(
        "clean copy — no violations",
        run_preprocess("Your changes are saved. Go to settings to update your preferences."),
        [],
    )

    # --- Novel eval stable fails (the cases this layer was built to fix) ---
    print("\nNovel eval stable fails")
    test(
        "NOVEL: GRM-01 missing oxford comma",
        run_preprocess("You can track orders, manage returns and contact support from your account page."),
        ["GRM-01"],
    )
    test(
        "NOVEL: GRM-05 spelled-out numbers",
        run_preprocess("You have two new notifications and five pending requests."),
        ["GRM-05"],
    )
    test(
        "NOVEL: GRM-05 number starts sentence (should NOT flag)",
        run_preprocess("Twelve users are currently online."),
        [],
    )

    # --- Additional edge cases ---
    print("\nEdge cases")
    test(
        "compound sentence — not a list",
        check_oxford_comma("I opened the app, and it crashed immediately."),
        [],
    )
    test(
        "4-item list missing comma",
        check_oxford_comma("We support Chrome, Firefox, Safari and Edge."),
        ["GRM-01"],
    )
    test(
        "'one' as actual count",
        check_numerals("You have one notification."),
        [],  # "one" is excluded because it's commonly a pronoun
    )
    test(
        "version numbers should not flag",
        check_numerals("Upgrade to version 3.2.1 for new features."),
        [],
    )
    test(
        "number in the middle of a sentence",
        check_numerals("Select three items from the list below."),
        ["GRM-05"],
    )
    test(
        "multiple sentences, number starts second",
        check_numerals("You have 5 items. Seven are on sale right now."),
        [],  # "Seven" starts its sentence
    )
    test(
        "P&G brand pass",
        check_ampersand("Brought to you by P&G"),
        [],
    )

    print(f"\n{'='*40}")
    print(f"Passed: {counts['passed']}  Failed: {counts['failed']}")
    if counts["failed"] == 0:
        print("\033[32mAll tests passed.\033[0m")
    else:
        print(f"\033[31m{counts['failed']} test(s) failed.\033[0m")
