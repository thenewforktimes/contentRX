"""Deterministic preprocessor for the content standards checker.

Handles mechanical, binary checks that the LLM consistently misses or
over-applies. Runs at zero API cost in under a millisecond.

Design principle: the preprocessor only makes calls it cannot get wrong.
If there is any judgment involved, the check goes to the LLM. The default
outcome is always "can't tell" → defer to LLM.

Three outcomes per check:
    VIOLATION  — definite problem, no context changes the answer
    PASS       — definitely fine, suppress any LLM violation for this standard
    DEFER      — can't tell, send to LLM

Post-processing suppression: when the preprocessor returns PASS for a
standard, that pass is authoritative. If the LLM later flags a violation
for the same standard, the merge stage suppresses it.
"""

import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Outcome model
# ---------------------------------------------------------------------------

class Outcome(Enum):
    VIOLATION = "violation"
    PASS = "pass"
    DEFER = "defer"


@dataclass
class PreprocessResult:
    """Result of a single preprocessor check."""

    standard_id: str
    outcome: Outcome
    issue: Optional[str] = None
    suggestion: Optional[str] = None

    @property
    def is_violation(self) -> bool:
        return self.outcome == Outcome.VIOLATION

    @property
    def is_pass(self) -> bool:
        return self.outcome == Outcome.PASS

    @property
    def is_defer(self) -> bool:
        return self.outcome == Outcome.DEFER


# ---------------------------------------------------------------------------
# Common-knowledge abbreviation allowlist (GRM-02, pass-only)
# ---------------------------------------------------------------------------

# These abbreviations are universally understood and never require expansion.
# The preprocessor can ONLY pass abbreviations on this list. Unknown
# abbreviations always defer to the LLM for audience-aware judgment.
COMMON_ABBREVIATIONS = frozenset({
    # Technology
    "API", "APIs", "SDK", "SDKs", "URL", "URLs", "HTML", "CSS", "PDF",
    "USB", "GPS", "Wi-Fi", "WIFI", "SaaS", "AI", "IT", "UI", "UX",
    "DNS", "HTTP", "HTTPS", "FTP", "SQL", "CMS", "CDN", "RAM", "CPU",
    "GPU", "SSD", "OS", "iOS", "VPN", "SSL", "TLS", "SSO", "OTP",

    # Business and government
    "CEO", "CTO", "CFO", "COO", "HR", "LLC", "IRS", "FAQ", "FAQs",
    "ID", "PIN", "ATM", "IPO", "ROI", "KPI", "B2B", "B2C", "PR",
    "QA", "R&D", "VP", "SVP", "EVP", "MBA", "CPA", "ESG",

    # Healthcare and accessibility
    "TTY", "ADA", "HIPAA", "ER", "ICU", "RN", "MD", "OTC", "Rx",
    "CPR", "EHR", "EMR", "FDA",

    # Finance
    "ACH", "FDIC", "FICO", "APR", "APY", "ETF", "IRA", "401k",
    "W-2", "W-9", "1099",

    # Common
    "ZIP", "RSVP", "TV", "DVD", "AC", "AM", "PM", "USA", "UK", "EU",
    "UN", "NATO", "NASA", "ASAP", "ETA", "FYI", "DIY", "PDF", "JPEG",
    "PNG", "GIF", "MP3", "MP4",
})

# ---------------------------------------------------------------------------
# Brand names with ampersands (GRM-04)
# ---------------------------------------------------------------------------

BRAND_AMPERSANDS = frozenset({
    "AT&T", "H&M", "S&P", "D&G", "M&M", "M&Ms", "H&R Block",
    "Johnson & Johnson", "J&J", "Procter & Gamble", "P&G",
    "Ben & Jerry's", "Ben & Jerrys", "Dolce & Gabbana",
    "Tiffany & Co", "Abercrombie & Fitch", "A&W", "B&H",
    "Barnes & Noble", "Simon & Schuster", "Ernst & Young", "EY",
    "Arm & Hammer", "Bed Bath & Beyond", "Liz Claiborne & Co",
    "Standard & Poor's", "Marks & Spencer", "R&B",
})


# ---------------------------------------------------------------------------
# Content type sets for ampersand check
# ---------------------------------------------------------------------------

# Content types where ampersands are acceptable (space-constrained)
AMPERSAND_ALLOWED_TYPES = frozenset({
    "heading", "ui_label", "button_cta",
})

# Content types where ampersands in non-brand text are violations
AMPERSAND_FORBIDDEN_TYPES = frozenset({
    "short_ui_copy", "long_form_copy", "tooltip_microcopy",
    "error_message", "confirmation",
})


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

def check_grm03_exclamation_points(text: str) -> PreprocessResult:
    """GRM-03: Flag multiple consecutive exclamation marks.

    Single exclamation marks are a judgment call (the LLM handles those).
    Multiple consecutive exclamation marks are never acceptable.
    """
    if re.search(r"!{2,}", text):
        return PreprocessResult(
            standard_id="GRM-03",
            outcome=Outcome.VIOLATION,
            issue="Multiple consecutive exclamation marks.",
            suggestion="Use a single exclamation mark or remove it entirely.",
        )
    return PreprocessResult(standard_id="GRM-03", outcome=Outcome.DEFER)


def check_grm04_ampersands(text: str, content_type: str) -> PreprocessResult:
    """GRM-04: Flag ampersands in body copy, pass them in headings/nav/labels.

    The revised GRM-04 allows ampersands in space-constrained UI elements.
    The preprocessor needs the content type to make this call.
    """
    if "&" not in text:
        return PreprocessResult(standard_id="GRM-04", outcome=Outcome.PASS)

    # Check if the ampersand is inside a known brand name
    for brand in BRAND_AMPERSANDS:
        if brand.lower() in text.lower():
            return PreprocessResult(standard_id="GRM-04", outcome=Outcome.PASS)

    # HTML entities (&amp;, &nbsp;, etc.) are not ampersands in copy
    text_without_entities = re.sub(r"&[a-zA-Z]+;", "", text)
    text_without_entities = re.sub(r"&#\d+;", "", text_without_entities)
    if "&" not in text_without_entities:
        return PreprocessResult(standard_id="GRM-04", outcome=Outcome.PASS)

    # Content type determines the verdict
    if content_type in AMPERSAND_ALLOWED_TYPES:
        return PreprocessResult(standard_id="GRM-04", outcome=Outcome.PASS)

    if content_type in AMPERSAND_FORBIDDEN_TYPES:
        return PreprocessResult(
            standard_id="GRM-04",
            outcome=Outcome.VIOLATION,
            issue="Ampersand used in body copy. Use 'and' instead.",
            suggestion=text.replace(" & ", " and ").replace("& ", "and ").replace(" &", " and"),
        )

    # Unknown content type → can't tell
    return PreprocessResult(standard_id="GRM-04", outcome=Outcome.DEFER)


def check_grm01_oxford_comma(text: str) -> PreprocessResult:
    """GRM-01: Flag missing Oxford comma in clear 3+ item lists.

    Only fires on patterns where three or more list items are unambiguous.
    Conservative: defers on anything that might not be a list.

    Strategy: find " and " or " or " in the text, check if there are commas
    before the conjunction (indicating a list), and verify the last comma
    is NOT immediately before the conjunction (which would mean the Oxford
    comma is present).
    """
    for conjunction in ("and", "or"):
        # Find word-bounded conjunction with spaces
        conj_re = re.compile(r"\s+" + conjunction + r"\s+", re.IGNORECASE)
        match = conj_re.search(text)
        if not match:
            continue

        before_conj = text[:match.start()]

        # Must have at least one comma before the conjunction
        commas = [i for i, c in enumerate(before_conj) if c == ","]
        if not commas:
            continue

        # Check the text between the last comma and the conjunction.
        # If there's no additional comma in that span, the Oxford comma
        # is missing.
        last_comma_pos = commas[-1]
        between = before_conj[last_comma_pos + 1:].strip()

        # The span between the last comma and the conjunction should be
        # a list item (some words, no commas). If it's empty, skip.
        if not between:
            continue

        # If the Oxford comma WERE present, there would be a comma
        # right before the conjunction — meaning "between" would be empty
        # or the last comma would be adjacent. Since "between" has content
        # and no additional comma, this is a missing Oxford comma.
        return PreprocessResult(
            standard_id="GRM-01",
            outcome=Outcome.VIOLATION,
            issue=f"Missing Oxford comma before '{conjunction}' in a list.",
            suggestion=f"Add a comma before '{conjunction}'.",
        )

    return PreprocessResult(standard_id="GRM-01", outcome=Outcome.DEFER)


def check_grm05_numerals(text: str) -> PreprocessResult:
    """GRM-05: Flag spelled-out numbers that should be numerals.

    Escape hatches:
    - Numbers at the start of a sentence (correctly spelled out)
    - "number one" as a rank/title
    - Ordinals (first, second, third)
    - Common phrases where spelled-out is conventional ("one of", "one time")
    """
    number_words = {
        "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
        "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
        "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
        "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
        "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    }

    # "one" is handled separately because it appears in too many safe phrases
    one_safe_contexts = (
        "number one", "one of", "one more", "one time", "one day",
        "one way", "one thing", "one another", "one by one", "one at a time",
        "no one", "any one", "every one", "each one", "this one",
        "that one", "which one", "someone", "anyone", "everyone",
    )

    text_lower = text.lower()

    # Check "one" separately with safe context handling
    if re.search(r"\bone\b", text_lower):
        # Check if "one" is in a safe context
        in_safe_context = any(phrase in text_lower for phrase in one_safe_contexts)
        if not in_safe_context:
            # Check if it starts a sentence
            sentences = re.split(r"(?<=[.!?])\s+", text)
            for sentence in sentences:
                s_lower = sentence.strip().lower()
                if not s_lower:
                    continue
                words = s_lower.split()
                if words and words[0] == "one":
                    return PreprocessResult(standard_id="GRM-05", outcome=Outcome.PASS)
                if re.search(r"\bone\b", s_lower) and words[0] != "one":
                    return PreprocessResult(
                        standard_id="GRM-05",
                        outcome=Outcome.VIOLATION,
                        issue="'One' should be written as a numeral.",
                        suggestion="Use '1' instead of 'one'.",
                    )

    # Check all other number words
    sentences = re.split(r"(?<=[.!?])\s+", text)
    for word, numeral in number_words.items():
        for sentence in sentences:
            s_lower = sentence.strip().lower()
            if not s_lower:
                continue

            if not re.search(r"\b" + word + r"\b", s_lower):
                continue

            # Check if it starts the sentence (exception: correctly spelled out)
            words = s_lower.split()
            if words and words[0] == word:
                return PreprocessResult(standard_id="GRM-05", outcome=Outcome.PASS)

            # Mid-sentence → violation
            return PreprocessResult(
                standard_id="GRM-05",
                outcome=Outcome.VIOLATION,
                issue=f"'{word.capitalize()}' should be written as a numeral.",
                suggestion=f"Use '{numeral}' instead of '{word}'.",
            )

    return PreprocessResult(standard_id="GRM-05", outcome=Outcome.DEFER)


def check_con03_date_formats(text: str) -> PreprocessResult:
    """CON-03: Flag numeric-only date formats.

    Definite violation: dates like 3/16/26, 03-16-2026, 16.03.2026
    Definite pass: dates with spelled-out months (March 16, 2026)
    Defers on ambiguous patterns that might be version numbers or IDs.
    """
    # Numeric date patterns (various separators)
    numeric_date = re.compile(
        r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b"
    )

    match = numeric_date.search(text)
    if match:
        full_match = match.group(0)

        # Exclude likely version numbers (e.g., 2.0.1, 1.2.3)
        # Version numbers typically have small segments and use dots
        parts = re.split(r"[/\-.]", full_match)
        if all(len(p) <= 2 for p in parts) and "." in full_match:
            # Could be a version number like 2.0.1 → defer
            return PreprocessResult(standard_id="CON-03", outcome=Outcome.DEFER)

        return PreprocessResult(
            standard_id="CON-03",
            outcome=Outcome.VIOLATION,
            issue=f"Numeric date format '{full_match}'. Spell out the month.",
            suggestion="Use a format like 'March 16, 2026' instead.",
        )

    return PreprocessResult(standard_id="CON-03", outcome=Outcome.DEFER)


def check_grm02_abbreviations(text: str) -> PreprocessResult:
    """GRM-02: Pass universally known abbreviations. Defer everything else.

    The preprocessor can ONLY pass abbreviations on the common-knowledge
    allowlist. It never flags an abbreviation as a violation — that requires
    audience-aware judgment from the LLM.
    """
    # Find all-caps words (2+ letters) that might be abbreviations
    abbr_pattern = re.compile(r"\b([A-Z][A-Z0-9&\-]{1,})\b")
    found_abbrs = abbr_pattern.findall(text)

    if not found_abbrs:
        return PreprocessResult(standard_id="GRM-02", outcome=Outcome.DEFER)

    # Check if ALL found abbreviations are on the allowlist
    unknown_abbrs = [
        a for a in found_abbrs
        if a not in COMMON_ABBREVIATIONS
        and a not in ("AM", "PM")  # time-related, always fine
    ]

    if not unknown_abbrs:
        # Every abbreviation in the text is universally known
        return PreprocessResult(standard_id="GRM-02", outcome=Outcome.PASS)

    # At least one unknown abbreviation → defer to LLM
    return PreprocessResult(standard_id="GRM-02", outcome=Outcome.DEFER)


def check_legal_content(text: str) -> bool:
    """Detect legal/regulatory boilerplate that should skip standards checking.

    Returns True if the text is legal content that should be routed away
    from all standards evaluation. Requires multiple signals to activate —
    a single legal-sounding phrase in normal UI copy won't trigger this.
    """
    signals = 0

    # Entity patterns
    if re.search(r"\b\w+,?\s+(Inc\.|LLC|Corp\.|Ltd\.)", text):
        signals += 1

    # Legal phrases
    legal_phrases = (
        "offered and underwritten by",
        "terms and conditions apply",
        "subject to applicable",
        "pursuant to",
        "governed by the laws",
        "underwritten by",
        "enrollment depends on contract renewal",
        "all plans are offered and underwritten",
        "with a medicare contract",
        "with medicare contracts",
        "plan with a medicare",
    )
    for phrase in legal_phrases:
        if phrase.lower() in text.lower():
            signals += 1
            break  # count legal phrases as one signal, not N

    # Regulatory codes (e.g., Y0043_N00043551_V2_M)
    if re.search(r"[A-Z]\d{4}_[A-Z]\d+", text):
        signals += 1

    # Multiple jurisdiction references
    states = re.findall(
        r"\bIn (California|Colorado|Georgia|Hawaii|Oregon|Washington|"
        r"Maryland|Virginia|District of Columbia)\b",
        text,
    )
    if len(states) >= 2:
        signals += 1

    # Copyright notices
    if re.search(r"©\s*\d{4}", text):
        signals += 1

    # Require multiple signals to avoid false triggers
    return signals >= 2


# ---------------------------------------------------------------------------
# Proofing checks (PRF): typography and formatting errors
#
# These are universal proofing catches — not content design standards,
# but the kind of errors that no shipped copy should contain. They don't
# require judgment, just attention to detail.
# ---------------------------------------------------------------------------

def check_prf01_double_spaces(text: str) -> PreprocessResult:
    """PRF-01: Flag multiple consecutive spaces between words.

    Always wrong in digital content. Common cause: copy-pasted from Word
    docs, manual formatting, or double-tapping the spacebar.
    """
    if re.search(r"[^\n] {2,}[^\n]", text):
        return PreprocessResult(
            standard_id="PRF-01",
            outcome=Outcome.VIOLATION,
            issue="Double space between words.",
            suggestion="Use a single space between words.",
        )
    return PreprocessResult(standard_id="PRF-01", outcome=Outcome.PASS)


def check_prf02_repeated_words(text: str) -> PreprocessResult:
    """PRF-02: Flag immediately repeated words ('the the', 'and and').

    Almost always a typo. The one edge case — 'that that' in constructions
    like 'I know that that is true' — is rare in UI copy and even there
    it's usually better rewritten.
    """
    # Match any word immediately followed by the same word (case-insensitive)
    match = re.search(r"\b(\w+)\s+\1\b", text, re.IGNORECASE)
    if match:
        word = match.group(1)
        return PreprocessResult(
            standard_id="PRF-02",
            outcome=Outcome.VIOLATION,
            issue=f"Repeated word: '{word} {word}'.",
            suggestion=f"Remove the duplicate '{word}'.",
        )
    return PreprocessResult(standard_id="PRF-02", outcome=Outcome.PASS)


def check_prf03_trailing_period_on_headings(
    text: str, content_type: str,
) -> PreprocessResult:
    """PRF-03: Flag periods at the end of headings and button labels.

    Headings and CTAs don't take terminal periods. Question marks and
    exclamation marks are fine (though exclamation marks are separately
    evaluated by GRM-03 for overuse).
    """
    if content_type not in ("heading", "button_cta", "ui_label"):
        return PreprocessResult(standard_id="PRF-03", outcome=Outcome.DEFER)

    stripped = text.rstrip()
    if stripped.endswith(".") and not stripped.endswith("..."):
        return PreprocessResult(
            standard_id="PRF-03",
            outcome=Outcome.VIOLATION,
            issue=f"Trailing period on a {content_type.replace('_', ' ')}.",
            suggestion="Remove the period. Headings, buttons, and labels don't need terminal punctuation.",
        )
    return PreprocessResult(standard_id="PRF-03", outcome=Outcome.PASS)


def check_prf04_straight_quotes(text: str, content_type: str) -> PreprocessResult:
    """PRF-04: Flag straight quotes in published copy.

    Straight quotes (' and ") are typewriter artifacts. Published UI copy
    should use curly quotes (' ' and " "). Exception: developer-facing
    content legitimately uses straight quotes for code.
    """
    # Skip developer-facing content types where straight quotes are expected
    developer_types = ("tooltip_microcopy",)  # conservative — only skip obvious cases
    if content_type in developer_types:
        return PreprocessResult(standard_id="PRF-04", outcome=Outcome.DEFER)

    # Check for straight quotes that aren't inside what looks like code
    # (backticks, angle brackets, etc.)
    text_without_code = re.sub(r"`[^`]+`", "", text)  # remove backtick code spans
    text_without_code = re.sub(r"<[^>]+>", "", text_without_code)  # remove HTML tags

    has_straight_single = "'" in text_without_code
    has_straight_double = '"' in text_without_code

    if has_straight_single or has_straight_double:
        # Check if these are apostrophes in contractions (don't, can't, you're)
        # Contractions with straight apostrophes are extremely common and
        # are a system/font issue, not a content design issue. Defer these.
        text_without_contractions = re.sub(
            r"\w'\w", "", text_without_code,
        )
        # Check for possessives too (user's, company's)
        text_without_possessives = re.sub(
            r"\w's\b", "", text_without_contractions,
        )

        remaining_straight_single = "'" in text_without_possessives
        remaining_straight_double = '"' in text_without_code

        if remaining_straight_single or remaining_straight_double:
            return PreprocessResult(
                standard_id="PRF-04",
                outcome=Outcome.VIOLATION,
                issue="Straight quotes in published copy.",
                suggestion="Use curly quotes (\u2018 \u2019 \u201c \u201d) instead of straight quotes (' \").",
            )

    return PreprocessResult(standard_id="PRF-04", outcome=Outcome.PASS)


def check_prf05_missing_space_after_punctuation(text: str) -> PreprocessResult:
    """PRF-05: Flag missing space after sentence-ending punctuation.

    'Click here.Then sign in' — a period, exclamation mark, or question
    mark immediately followed by a letter. Always a typo.

    Exceptions: URLs, email addresses, file extensions, abbreviations
    like 'a.m.' and 'e.g.', and decimal numbers.
    """
    # Remove URLs and email-like patterns first
    cleaned = re.sub(r"https?://\S+", "", text)
    cleaned = re.sub(r"\S+@\S+\.\S+", "", cleaned)
    # Remove common abbreviations with periods
    cleaned = re.sub(r"\b(a\.m|p\.m|e\.g|i\.e|vs|Dr|Mr|Mrs|Ms|Jr|Sr|St)\.", "", cleaned, flags=re.IGNORECASE)
    # Remove decimal numbers
    cleaned = re.sub(r"\d+\.\d+", "", cleaned)
    # Remove file extensions (common ones only)
    cleaned = re.sub(r"\.(pdf|doc|docx|xls|xlsx|csv|txt|html|css|js|json|png|jpg|jpeg|gif|svg|zip|xml|yaml|yml|md)\b", "", cleaned, flags=re.IGNORECASE)
    # Remove ellipsis (three dots)
    cleaned = re.sub(r"\.{3}", "", cleaned)

    # Now check for punctuation immediately followed by a letter
    if re.search(r"[.!?][A-Za-z]", cleaned):
        return PreprocessResult(
            standard_id="PRF-05",
            outcome=Outcome.VIOLATION,
            issue="Missing space after punctuation.",
            suggestion="Add a space after the period, exclamation mark, or question mark.",
        )
    return PreprocessResult(standard_id="PRF-05", outcome=Outcome.PASS)


def check_prf06_leading_trailing_whitespace(text: str) -> PreprocessResult:
    """PRF-06: Flag leading or trailing whitespace in UI copy.

    Published UI strings should not start or end with spaces, tabs, or
    newlines. Common cause: copy-paste artifacts, accidental spaces in
    Figma text layers, or string concatenation errors in code.
    """
    if text != text.strip():
        return PreprocessResult(
            standard_id="PRF-06",
            outcome=Outcome.VIOLATION,
            issue="Leading or trailing whitespace.",
            suggestion="Remove spaces, tabs, or newlines from the beginning and end of the string.",
        )
    return PreprocessResult(standard_id="PRF-06", outcome=Outcome.PASS)


def check_prf07_space_before_punctuation(text: str) -> PreprocessResult:
    """PRF-07: Flag spaces before punctuation marks.

    'Click here .' or 'Save changes ,' — a space immediately before a
    period, comma, semicolon, colon, exclamation mark, or question mark.
    Always a typo in English.

    Exception: ellipsis preceded by a space is acceptable in some styles.
    """
    # Remove ellipsis patterns first
    cleaned = re.sub(r"\s*\.{3}", "", text)

    if re.search(r"\s+[.,;:!?]", cleaned):
        return PreprocessResult(
            standard_id="PRF-07",
            outcome=Outcome.VIOLATION,
            issue="Space before punctuation mark.",
            suggestion="Remove the space before the punctuation.",
        )
    return PreprocessResult(standard_id="PRF-07", outcome=Outcome.PASS)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def preprocess(
    text: str,
    content_type: str,
) -> list[PreprocessResult]:
    """Run all deterministic checks on a piece of content.

    Args:
        text: The content to check.
        content_type: The classified content type (heading, ui_label, etc.).

    Returns:
        List of PreprocessResult objects. Each result covers one standard
        with an outcome of VIOLATION, PASS, or DEFER.
    """
    results = []

    # Standards-based checks
    results.append(check_grm03_exclamation_points(text))
    results.append(check_grm04_ampersands(text, content_type))
    results.append(check_grm01_oxford_comma(text))
    results.append(check_grm05_numerals(text))
    results.append(check_con03_date_formats(text))
    results.append(check_grm02_abbreviations(text))

    # Proofing checks (typography and formatting)
    results.append(check_prf01_double_spaces(text))
    results.append(check_prf02_repeated_words(text))
    results.append(check_prf03_trailing_period_on_headings(text, content_type))
    results.append(check_prf04_straight_quotes(text, content_type))
    results.append(check_prf05_missing_space_after_punctuation(text))
    results.append(check_prf06_leading_trailing_whitespace(text))
    results.append(check_prf07_space_before_punctuation(text))

    return results


def get_preprocess_violations(results: list[PreprocessResult]) -> list[dict]:
    """Extract violations from preprocess results as dicts matching the
    checker's violation format."""
    return [
        {
            "standard_id": r.standard_id,
            "rule": f"[Preprocessor] {r.standard_id}",
            "issue": r.issue,
            "suggestion": r.suggestion,
        }
        for r in results
        if r.is_violation
    ]


def get_suppressed_standards(results: list[PreprocessResult]) -> set[str]:
    """Get the set of standard IDs that the preprocessor definitively passed.

    Any LLM violation for these standards should be suppressed in the
    merge stage — the preprocessor's pass is authoritative.
    """
    return {r.standard_id for r in results if r.is_pass}


# ---------------------------------------------------------------------------
# Package integration: run_preprocess() returns Violation objects
# ---------------------------------------------------------------------------

def run_preprocess(text: str, content_type: str = "short_ui_copy"):
    """Run all deterministic checks and return violations as Violation objects.

    This is the entry point used by pipeline.py. It bridges the internal
    PreprocessResult model to the package's Violation model.

    Also stores `_suppressed_ids` on the returned list so the pipeline
    can access which standards the preprocessor definitively passed.
    This enables post-processing suppression: when the preprocessor says
    PASS, it overrides any LLM violation for the same standard.

    Args:
        text: The content to check.
        content_type: The classified content type (heading, ui_label, etc.).

    Returns:
        List of Violation objects (only violations, not passes or defers).
        The list has a `_suppressed_ids` attribute (set of standard IDs
        the preprocessor definitively passed).
    """
    results = preprocess(text, content_type)
    suppressed = get_suppressed_standards(results)

    # Import here to avoid circular imports when used inside the package
    try:
        from content_checker.models import Violation
    except ImportError:
        # Standalone usage outside the package — return dicts instead
        violations = get_preprocess_violations(results)
        return violations

    violations = []
    for r in results:
        if r.is_violation:
            violations.append(Violation(
                standard_id=r.standard_id,
                rule=r.issue or "",
                issue=r.issue or "",
                suggestion=r.suggestion or "",
                source="deterministic",
            ))

    # Attach suppressed IDs to the list for pipeline access
    violations = _ViolationList(violations, suppressed)
    return violations


class _ViolationList(list):
    """A list that also carries suppressed standard IDs.

    This avoids changing the run_preprocess() return type signature
    while still exposing suppression data to the pipeline.
    """

    def __init__(self, violations, suppressed_ids):
        super().__init__(violations)
        self.suppressed_ids = suppressed_ids
