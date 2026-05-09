"""Deterministic preprocessor for the content standards checker.

Handles mechanical, binary checks that the LLM consistently misses or
over-applies. Runs at zero API cost in under a millisecond.

Design principle: the preprocessor makes calls of two kinds —

    Factual detections (em dash present, sentence over 25 words, Latin
    abbreviation in copy). The text either has the pattern or it doesn't;
    no context changes the answer. These ship at confidence 1.0.

    Shape detections (a capitalized non-first word that looks like title
    case, a device-specific verb that looks like a click instruction).
    The space of valid abbreviations, proper nouns, brand names, and
    industry vocabulary is unbounded — no allowlist will ever be
    exhaustive. The preprocessor is qualified to flag the SHAPE, not to
    render the verdict. These ship at confidence 0.65, which routes
    through `derive_verdict` to `review_recommended` (soft surface) and
    use soft-guidance voice in issue/suggestion text. The override
    stream + refinement-log loop is the real curation mechanism for
    growing the allowlists over time.

Three outcomes per check:
    VIOLATION  — pattern detected (factual at conf 1.0; shape at conf 0.65)
    PASS       — definitely fine, suppress any LLM violation for this standard
    DEFER      — can't tell, send to LLM

Post-processing suppression: when the preprocessor returns PASS for a
standard, that pass is authoritative. If the LLM later flags a violation
for the same standard, the merge stage suppresses it.

Check inventory (29 checks):
    Standards-based: GRM-01, GRM-02, GRM-03, GRM-04, GRM-05, GRM-06,
                     GRM-07, CON-02 (sentence case + strict headings),
                     CON-03, ACT-01, ACC-01, ACC-08
    Proofing:        PRF-01 through PRF-11
    Clarity:         CLR-01 (redundant phrases + banned words),
                     CLR-03 (sentence length)
    Inclusion:       INC-01, INC-02
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from content_checker.audience import Audience

# ---------------------------------------------------------------------------
# Standard IDs the preprocessor can produce
# ---------------------------------------------------------------------------

# Canonical set of standard IDs the preprocessor can produce.
# Used by test fixtures to verify library coverage without depending
# on magic input strings. Update when adding or removing checks.
PREPROCESSOR_STANDARD_IDS: frozenset[str] = frozenset({
    # Grammar (7)
    "GRM-01",  # Oxford comma
    "GRM-02",  # Abbreviation allowlist (pass-only)
    "GRM-03",  # Exclamation points
    "GRM-04",  # Ampersands (content-type-aware)
    "GRM-05",  # Numerals (unicode hyphen normalization)
    "GRM-06",  # Compound modifier hyphenation
    # Convention (2)
    "CON-02",  # Sentence case (pass-only sentence_case + strict_headings sibling)
    "CON-03",  # Date formats
    # Action (1)
    "ACT-01",  # Binary response buttons (pass-only)
    # Proofing (11)
    "PRF-01",  # Double spaces (data display pipe exception)
    "PRF-02",  # Repeated words
    "PRF-03",  # Trailing period on headings
    "PRF-04",  # Straight quotes (inch mark exception)
    "PRF-05",  # Missing space after punctuation
    "PRF-06",  # Leading/trailing whitespace
    "PRF-07",  # Space before punctuation
    "PRF-08",  # Placeholder text
    "PRF-09",  # All caps
    "PRF-10",  # Latin abbreviations
    "PRF-11",  # Dismissive language
    # Clarity (2)
    "CLR-01",  # Redundant phrases + banned words
    "CLR-03",  # Sentence length (v4.7.1 — house-style P0)
    # Accessibility (2)
    "ACC-01",  # Vague link text
    "ACC-08",  # Device-specific verbs (v4.7.1 — house-style P0)
    # Inclusion (2)
    "INC-01",  # Gendered language
    "INC-02",  # Non-inclusive tech terminology
})
# 27 unique IDs across 29 check functions (CLR-01 + CON-02 each have two
# detection paths)

# ---------------------------------------------------------------------------
# Outcome model
# ---------------------------------------------------------------------------

class Outcome(Enum):
    VIOLATION = "violation"
    PASS = "pass"
    DEFER = "defer"


@dataclass
class PreprocessResult:
    """Result of a single preprocessor check.

    `confidence` defaults to 1.0 for factual detections (em dash present,
    sentence over threshold, Latin abbreviation in copy). Shape detections
    (CON-02 strict headings, ACC-08 device verbs) emit at 0.65 to reflect
    that the preprocessor is sure about the SHAPE but not the VIOLATION;
    the 0.65 confidence routes through `derive_verdict` to
    `review_recommended` rather than a hard `violation` verdict.
    """

    standard_id: str
    outcome: Outcome
    issue: str | None = None
    suggestion: str | None = None
    confidence: float = 1.0

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

COMMON_ABBREVIATIONS = frozenset({
    # Technology
    "API", "APIs", "SDK", "SDKs", "URL", "URLs", "HTML", "CSS", "PDF",
    "USB", "GPS", "Wi-Fi", "WIFI", "SaaS", "AI", "IT", "UI", "UX",
    "DNS", "HTTP", "HTTPS", "FTP", "SQL", "CMS", "CDN", "RAM", "CPU",
    "GPU", "SSD", "OS", "iOS", "VPN", "SSL", "TLS", "SSO", "OTP",
    # Tech additions (v4.7.1 — house-style P0 seed)
    "JSON", "XML", "YAML", "CSV", "REST", "CRUD", "IDE",

    # Business and government
    "CEO", "CTO", "CFO", "COO", "HR", "LLC", "IRS", "FAQ", "FAQs",
    "ID", "PIN", "ATM", "IPO", "ROI", "KPI", "B2B", "B2C", "PR",
    "QA", "R&D", "VP", "SVP", "EVP", "MBA", "CPA", "ESG",

    # Healthcare and accessibility
    "TTY", "ADA", "HIPAA", "ER", "ICU", "RN", "MD", "OTC", "Rx",
    "CPR", "EHR", "EMR", "FDA",
    # Healthcare additions (v4.7.1 — Kaiser/MEDVi beta seed)
    "PCP", "PPO", "HMO", "EOB", "COBRA", "COPD", "ADHD", "BMI",
    "DOB", "MRI", "PTSD", "GLP-1",

    # Finance
    "ACH", "FDIC", "FICO", "APR", "APY", "ETF", "IRA", "401k",
    "W-2", "W-9", "1099",
    # Finance additions (v4.7.1 — Stripe/Wells Fargo/Robinhood beta seed)
    "HSA", "FSA", "FICA", "ESPP", "RSU", "GAAP", "SEP",

    # Auth and security (v4.7.1 — house-style P0 seed)
    "2FA", "MFA", "JWT", "OIDC", "SAML", "TOTP",

    # Timezones (v4.7.1 — house-style P0 seed)
    "EST", "EDT", "PST", "PDT", "CST", "CDT", "MST", "MDT",
    "GMT", "UTC", "BST",

    # Common
    "ZIP", "RSVP", "TV", "DVD", "AC", "AM", "PM", "USA", "UK", "EU",
    "UN", "NATO", "NASA", "ASAP", "ETA", "FYI", "DIY", "PDF", "JPEG",
    "PNG", "GIF", "MP3", "MP4",
})

# ---------------------------------------------------------------------------
# Known acronyms for ALL CAPS check (PRF-09)
# Superset of COMMON_ABBREVIATIONS plus marketing/UI patterns
# ---------------------------------------------------------------------------

KNOWN_ACRONYMS = COMMON_ABBREVIATIONS | frozenset({
    "WCAG", "JSON", "XML", "YAML", "CSV", "REST", "SMTP", "IMAP", "POP",
    # Marketing/UI patterns that aren't violations
    "FREE", "SALE", "NEW", "BETA", "PRO", "VIP",
    # Dev markers caught by PRF-08 instead
    "TODO", "FIXME", "TBD", "WIP", "DRAFT", "PLACEHOLDER",
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
# Data display pattern exception (PRF-01)
# ---------------------------------------------------------------------------

# Padded pipe separators in data visualizations: "63.6%  |  4.7M"
# Uses lookbehind/lookahead to confirm data-like characters on both sides.
# This prevents PRF-01 from flagging intentional formatting in dashboards
# and chart labels. Added from Opendoor triage Cluster 2 (12 false positives).
_DATA_DISPLAY_PIPE = re.compile(
    r"(?<=[\d$%\.KMBkmb])\s{2,}\|\s{2,}(?=[\d$%\.KMBkmb])"
)


# ---------------------------------------------------------------------------
# Binary response buttons (ACT-01 pass-only check)
# ---------------------------------------------------------------------------

# Standalone response buttons that don't need a leading verb.
# ACT-01 ("start with a verb") doesn't apply to Yes/No/OK/Cancel buttons.
# Same architectural pattern as GRM-02: pass-only, never flags violations.
# Added from Opendoor triage Cluster 4 (8 false positives eliminated).
_BINARY_RESPONSES = frozenset({
    "yes", "no", "ok", "okay", "cancel", "dismiss",
    "got it", "not now", "maybe later", "no thanks",
    "allow", "deny", "accept", "decline", "skip",
    "confirm", "reject", "agreed", "disagree",
})

# Compound confirmations: "Yes, delete" / "OK, remove" / "No, keep editing"
_BINARY_COMPOUND_PREFIX = re.compile(
    r"^(yes|no|ok|okay),?\s+",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Content type sets for ampersand check
# ---------------------------------------------------------------------------

AMPERSAND_ALLOWED_TYPES = frozenset({
    "heading", "ui_label", "button_cta",
})

AMPERSAND_FORBIDDEN_TYPES = frozenset({
    "short_ui_copy", "long_form_copy", "tooltip_microcopy",
    "error_message", "confirmation",
})


# ---------------------------------------------------------------------------
# CON-02 safe-phrase allowlist
# Industry-standard two-word UI patterns that look like title case but are
# standard navigation/action patterns. Exact match on normalized full input.
# Expansion protocol: ≥2 confirmed false positives from triage → add + test.
# ---------------------------------------------------------------------------

CON02_SAFE_PHRASES = frozenset({
    "see all", "view all", "show all", "browse all",
    "show more", "load more", "view more", "see more", "load all",
    "sign in", "sign up", "sign out", "log in", "log out",
    "add new", "create new",
    "go back", "go home",
    "opt in", "opt out",
    "get started", "try free",
    # P0 seed (v4.7.1) — common UI phrasal patterns rendered title-case-ish:
    "set up", "back up", "follow up", "check in",
    "buy now", "shop now", "save now", "pay now", "send now",
    "free trial", "free plan", "pro plan", "team plan",
    "learn more", "find out",
})


# ═══════════════════════════════════════════════════════════════════════
# Individual checks — standards-based
# ═══════════════════════════════════════════════════════════════════════

def check_grm03_exclamation_points(text: str) -> PreprocessResult:
    """GRM-03: Flag multiple consecutive exclamation marks."""
    if re.search(r"!{2,}", text):
        return PreprocessResult(
            standard_id="GRM-03",
            outcome=Outcome.VIOLATION,
            issue="Multiple consecutive exclamation marks.",
            suggestion="Use a single exclamation mark or remove it entirely.",
        )
    return PreprocessResult(standard_id="GRM-03", outcome=Outcome.DEFER)


def check_grm04_ampersands(text: str, content_type: str) -> PreprocessResult:
    """GRM-04: Flag ampersands in body copy, pass them in headings/nav/labels."""
    if "&" not in text:
        return PreprocessResult(standard_id="GRM-04", outcome=Outcome.PASS)

    for brand in BRAND_AMPERSANDS:
        if brand.lower() in text.lower():
            return PreprocessResult(standard_id="GRM-04", outcome=Outcome.PASS)

    text_without_entities = re.sub(r"&[a-zA-Z]+;", "", text)
    text_without_entities = re.sub(r"&#\d+;", "", text_without_entities)
    if "&" not in text_without_entities:
        return PreprocessResult(standard_id="GRM-04", outcome=Outcome.PASS)

    if content_type in AMPERSAND_ALLOWED_TYPES:
        return PreprocessResult(standard_id="GRM-04", outcome=Outcome.PASS)

    if content_type in AMPERSAND_FORBIDDEN_TYPES:
        return PreprocessResult(
            standard_id="GRM-04",
            outcome=Outcome.VIOLATION,
            issue="Ampersand used in body copy. Use 'and' instead.",
            suggestion=text.replace(" & ", " and ").replace("& ", "and ").replace(" &", " and"),
        )

    return PreprocessResult(standard_id="GRM-04", outcome=Outcome.DEFER)


_GRM01_CONJUNCTION_RES: tuple[tuple[str, "re.Pattern[str]"], ...] = (
    ("and", re.compile(r"\s+and\s+", re.IGNORECASE)),
    ("or", re.compile(r"\s+or\s+", re.IGNORECASE)),
)


def check_grm01_oxford_comma(text: str) -> PreprocessResult:
    """GRM-01: Flag missing Oxford comma in clear 3+ item lists."""
    for conjunction, conj_re in _GRM01_CONJUNCTION_RES:
        match = conj_re.search(text)
        if not match:
            continue

        before_conj = text[:match.start()]
        commas = [i for i, c in enumerate(before_conj) if c == ","]
        if not commas:
            continue

        last_comma_pos = commas[-1]
        between = before_conj[last_comma_pos + 1:].strip()

        if not between:
            continue

        return PreprocessResult(
            standard_id="GRM-01",
            outcome=Outcome.VIOLATION,
            issue=f"Missing Oxford comma before '{conjunction}' in a list.",
            suggestion=f"Add a comma before '{conjunction}'.",
        )

    return PreprocessResult(standard_id="GRM-01", outcome=Outcome.DEFER)


def check_grm05_numerals(text: str) -> PreprocessResult:
    """GRM-05: Flag spelled-out numbers that should be numerals."""
    number_words = {
        "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
        "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
        "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
        "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
        "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    }

    one_safe_contexts = (
        "number one", "one of", "one more", "one time", "one day",
        "one way", "one thing", "one another", "one by one", "one at a time",
        "no one", "any one", "every one", "each one", "this one",
        "that one", "which one", "someone", "anyone", "everyone",
        # Compound/hyphenated uses (from Apple eval)
        "one on one", "one-on-one", "one-way", "one app",
        # Duration and brand contexts (from Apple eval v4.4.2)
        "one year", "one-year", "applecare one",
    )

    # Normalize unicode hyphens to ASCII before safe context matching.
    # U+2011 (non-breaking hyphen) and U+2010 (hyphen) appear in Apple
    # product copy and prevent matches against safe phrases like "one-year".
    text_lower = text.lower().replace("\u2011", "-").replace("\u2010", "-")

    if re.search(r"\bone\b", text_lower):
        in_safe_context = any(phrase in text_lower for phrase in one_safe_contexts)
        if not in_safe_context:
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

    sentences = re.split(r"(?<=[.!?])\s+", text)
    for word, numeral in number_words.items():
        for sentence in sentences:
            s_lower = sentence.strip().lower()
            if not s_lower:
                continue
            if not re.search(r"\b" + word + r"\b", s_lower):
                continue
            words = s_lower.split()
            if words and words[0] == word:
                return PreprocessResult(standard_id="GRM-05", outcome=Outcome.PASS)
            return PreprocessResult(
                standard_id="GRM-05",
                outcome=Outcome.VIOLATION,
                issue=f"'{word.capitalize()}' should be written as a numeral.",
                suggestion=f"Use '{numeral}' instead of '{word}'.",
            )

    return PreprocessResult(standard_id="GRM-05", outcome=Outcome.DEFER)


# ---------------------------------------------------------------------------
# GRM-06: Compound modifier hyphenation
# ---------------------------------------------------------------------------

# Units that form compound modifiers with numbers: "5-day streak"
_GRM06_UNITS = frozenset({
    "day", "week", "month", "year", "hour", "minute", "second",
    "time", "step", "page", "word", "mile", "foot", "inch",
    "pound", "dollar", "percent", "factor", "way",
})

# Spelled-out numbers that form compound modifiers: "one-time offer"
_GRM06_SPELLED_NUMBERS = frozenset({
    "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "twenty", "thirty", "forty", "fifty", "hundred",
})

# Stopwords that follow "N unit" but indicate the unit is NOT a compound
# modifier: "5 days remaining", "in 5 days", "3 steps total"
_GRM06_STOPWORDS = frozenset({
    "of", "in", "for", "to", "from", "with", "at", "on", "by",
    "ago", "later", "remaining", "left", "total", "each", "per",
    "is", "are", "was", "were", "will", "has", "have", "had",
})

# Regex for numeric compound: digit(s) + space + unit (+ optional plural s)
_GRM06_NUMERIC_PASS = re.compile(
    r"\b(\d+)-((?:" + "|".join(_GRM06_UNITS) + r"))(?:s)?\b",
    re.IGNORECASE,
)
_GRM06_NUMERIC_VIOLATION = re.compile(
    r"\b(\d+)\s+((?:" + "|".join(_GRM06_UNITS) + r")(?:s)?)\b",
    re.IGNORECASE,
)

# Regex for spelled-out compound: number word + space + unit
_GRM06_SPELLED_PASS = re.compile(
    r"\b((?:" + "|".join(_GRM06_SPELLED_NUMBERS) + r"))-((?:" + "|".join(_GRM06_UNITS) + r"))(?:s)?\b",
    re.IGNORECASE,
)
_GRM06_SPELLED_VIOLATION = re.compile(
    r"\b((?:" + "|".join(_GRM06_SPELLED_NUMBERS) + r"))\s+((?:" + "|".join(_GRM06_UNITS) + r")(?:s)?)\b",
    re.IGNORECASE,
)


def _normalize_unit_singular(unit: str) -> str:
    """Normalize a unit to singular form, with double-s guard.

    "days" → "day", "hours" → "hour"
    "process" stays "process" (double-s guard)
    """
    if unit.endswith("ss"):
        return unit  # double-s guard: "process" stays "process"
    if unit.endswith("s") and unit[:-1].lower() in _GRM06_UNITS:
        return unit[:-1]
    return unit


def check_grm06_compound_modifiers(text: str) -> PreprocessResult:
    """GRM-06: Flag unhyphenated compound modifiers.

    Two scopes:
        Numeric:     "5 day streak" → "5-day streak"
        Spelled-out: "one time offer" → "one-time offer"

    PASS runs first — correctly hyphenated compounds suppress LLM re-flagging.
    Ordinal compounds ("first time user") deferred to LLM.

    Stopword lookahead prevents false positives on standalone durations:
        "5 days remaining" → DEFER (not a compound modifier)
        "in 5 days" → DEFER (prepositional phrase)
    """
    lower = text.lower()

    # --- PASS: correctly hyphenated compounds ---
    if _GRM06_NUMERIC_PASS.search(lower):
        return PreprocessResult(standard_id="GRM-06", outcome=Outcome.PASS)
    if _GRM06_SPELLED_PASS.search(lower):
        return PreprocessResult(standard_id="GRM-06", outcome=Outcome.PASS)

    # --- VIOLATION: numeric compounds without hyphens ---
    match = _GRM06_NUMERIC_VIOLATION.search(text)
    if match:
        number = match.group(1)
        raw_unit = match.group(2)
        unit = _normalize_unit_singular(raw_unit)

        # Stopword lookahead: check the word AFTER the unit
        after_match = text[match.end():].strip().split()
        next_word = after_match[0].lower().rstrip(".,;:!?") if after_match else ""

        if next_word in _GRM06_STOPWORDS or not next_word:
            return PreprocessResult(standard_id="GRM-06", outcome=Outcome.DEFER)

        suggestion = f"{number}-{unit}"
        return PreprocessResult(
            standard_id="GRM-06",
            outcome=Outcome.VIOLATION,
            issue=f"Unhyphenated compound modifier: '{number} {raw_unit}'. "
                  f"Hyphenate when modifying a noun.",
            suggestion=f"Use '{suggestion}' instead of '{number} {raw_unit}'.",
        )

    # --- VIOLATION: spelled-out compounds without hyphens ---
    match = _GRM06_SPELLED_VIOLATION.search(text)
    if match:
        number_word = match.group(1)
        raw_unit = match.group(2)
        unit = _normalize_unit_singular(raw_unit)

        after_match = text[match.end():].strip().split()
        next_word = after_match[0].lower().rstrip(".,;:!?") if after_match else ""

        if next_word in _GRM06_STOPWORDS or not next_word:
            return PreprocessResult(standard_id="GRM-06", outcome=Outcome.DEFER)

        suggestion = f"{number_word.lower()}-{unit}"
        return PreprocessResult(
            standard_id="GRM-06",
            outcome=Outcome.VIOLATION,
            issue=f"Unhyphenated compound modifier: '{number_word} {raw_unit}'. "
                  f"Hyphenate when modifying a noun.",
            suggestion=f"Use '{suggestion}' instead of '{number_word} {raw_unit}'.",
        )

    return PreprocessResult(standard_id="GRM-06", outcome=Outcome.DEFER)


def check_grm07_em_dashes(text: str) -> PreprocessResult:
    """GRM-07: Flag em dashes in copy.

    Internal/human-eval rule. Not run in the customer-facing
    preprocessor pipeline — em dashes in customer input are not a
    surfaced violation. The rule still exists for the human-evaluation
    layer that scores ContentRX's own rewrites: our generated rewrites
    must never use em dashes (enforced separately at
    `rewrite_document.py` and `suggestion_quality.is_slop`).

    En dashes are not flagged here. They have valid AP uses (ranges,
    relationships) and the prior rule was overly strict.

    Factual detection at confidence 1.0 when invoked.
    """
    if "—" in text:
        return PreprocessResult(
            standard_id="GRM-07",
            outcome=Outcome.VIOLATION,
            issue="Em dash in copy.",
            suggestion=(
                "Use a period, comma, colon, parens, or sentence break."
            ),
            confidence=1.0,
        )
    return PreprocessResult(standard_id="GRM-07", outcome=Outcome.PASS)


def check_con03_date_formats(text: str) -> PreprocessResult:
    """CON-03: Flag numeric-only date formats."""
    numeric_date = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")
    match = numeric_date.search(text)
    if match:
        full_match = match.group(0)
        parts = re.split(r"[/\-.]", full_match)
        if all(len(p) <= 2 for p in parts) and "." in full_match:
            return PreprocessResult(standard_id="CON-03", outcome=Outcome.DEFER)
        return PreprocessResult(
            standard_id="CON-03",
            outcome=Outcome.VIOLATION,
            issue=f"Numeric date format '{full_match}'. Spell out the month.",
            suggestion="Use a format like 'March 16, 2026' instead.",
        )
    return PreprocessResult(standard_id="CON-03", outcome=Outcome.DEFER)


def check_grm02_abbreviations(text: str) -> PreprocessResult:
    """GRM-02: Pass universally known abbreviations. Defer everything else."""
    abbr_pattern = re.compile(r"\b([A-Z][A-Z0-9&\-]{1,})\b")
    found_abbrs = abbr_pattern.findall(text)

    if not found_abbrs:
        return PreprocessResult(standard_id="GRM-02", outcome=Outcome.DEFER)

    unknown_abbrs = [
        a for a in found_abbrs
        if a not in COMMON_ABBREVIATIONS
        and a not in ("AM", "PM")
    ]

    if not unknown_abbrs:
        return PreprocessResult(standard_id="GRM-02", outcome=Outcome.PASS)

    return PreprocessResult(standard_id="GRM-02", outcome=Outcome.DEFER)


def check_con02_sentence_case(text: str) -> PreprocessResult:
    """CON-02: Verify sentence case deterministically. PASS-only check.

    Prevents LLM hallucinations where it flags clearly sentence-case
    text as "title case." The LLM is unreliable at character-level
    pattern matching. This regex does it perfectly.

    NEVER generates a VIOLATION. Only confirms text IS sentence case.
    """
    words = text.split()
    if len(words) <= 1:
        return PreprocessResult(standard_id="CON-02", outcome=Outcome.DEFER)

    # Safe-phrase allowlist: industry-standard two-word UI patterns
    # that look like title case but are conventional navigation/action text.
    # Exact match on normalized full input — never masks real title case.
    if text.strip().lower() in CON02_SAFE_PHRASES:
        return PreprocessResult(standard_id="CON-02", outcome=Outcome.PASS)

    for word in words[1:]:
        if not word:
            continue
        first_char = word[0]
        if first_char.isupper():
            # All-caps words (acronyms) don't indicate title case
            stripped = re.sub(r"[.,;:!?]$", "", word)
            if stripped == stripped.upper():
                continue
            if stripped in COMMON_ABBREVIATIONS:
                continue
            # A capitalized word after the first → could be title case → defer
            return PreprocessResult(standard_id="CON-02", outcome=Outcome.DEFER)

    # Every word after the first is lowercase or an acronym → sentence case
    return PreprocessResult(standard_id="CON-02", outcome=Outcome.PASS)


def check_con02_strict_headings(
    text: str, content_type: str,
) -> PreprocessResult:
    """CON-02 sibling: detect title-case shape on heading-style content.

    Shape detection at confidence 0.65 — emits VIOLATION but routes
    through derive_verdict to `review_recommended` (not a hard
    `violation`). Soft-guidance voice in issue/suggestion text.

    Sibling to check_con02_sentence_case (PASS-only by design — see
    that function's docstring). Both functions vote on CON-02:
        - When the text is genuinely sentence case, both PASS and the
          merge stage adds CON-02 to suppressed_ids, suppressing any
          LLM CON-02 finding.
        - When a non-allowlisted capitalized non-first word is present,
          sentence_case DEFERs and strict_headings flags VIOLATION at
          0.65 — the violation surfaces as `review_recommended`.

    The COMMON_ABBREVIATIONS + CON02_SAFE_PHRASES allowlists are a
    SEED, not exhaustive enumeration. The override stream + refinement
    log is the real curation mechanism for the unbounded space of
    valid renderings.
    """
    if content_type not in ("heading", "button_cta", "ui_label"):
        return PreprocessResult(standard_id="CON-02", outcome=Outcome.DEFER)

    words = text.split()
    if len(words) <= 1:
        return PreprocessResult(standard_id="CON-02", outcome=Outcome.DEFER)

    if text.strip().lower() in CON02_SAFE_PHRASES:
        return PreprocessResult(standard_id="CON-02", outcome=Outcome.DEFER)

    for word in words[1:]:
        if not word:
            continue
        first_char = word[0]
        if not first_char.isupper():
            continue
        stripped = re.sub(r"[.,;:!?]$", "", word)
        if stripped == stripped.upper():
            continue
        if stripped in COMMON_ABBREVIATIONS:
            continue
        # Found a capitalized non-first word not explained by an allowlist.
        return PreprocessResult(
            standard_id="CON-02",
            outcome=Outcome.VIOLATION,
            issue=(
                f"ContentRX noticed an unusual capitalization on "
                f"'{stripped}' — could be a proper noun, an acronym, "
                f"or your team's standard rendering. If that's "
                f"intentional, keep it."
            ),
            suggestion=(
                "If you wanted sentence case, lowercase any non-first "
                "words that aren't proper nouns, acronyms, or your "
                "team's standard rendering."
            ),
            confidence=0.65,
        )
    return PreprocessResult(standard_id="CON-02", outcome=Outcome.PASS)


def check_act01_binary_responses(text: str) -> PreprocessResult:
    """ACT-01: Pass binary response buttons that don't need a leading verb.

    Pass-only check. Same architectural pattern as GRM-02.
    Added from Opendoor triage Cluster 4 (8 false positives).
    """
    stripped = text.strip()
    normalized = stripped.lower()

    if normalized in _BINARY_RESPONSES:
        return PreprocessResult(standard_id="ACT-01", outcome=Outcome.PASS)

    words = stripped.split()
    if len(words) <= 5 and _BINARY_COMPOUND_PREFIX.match(stripped):
        return PreprocessResult(standard_id="ACT-01", outcome=Outcome.PASS)

    return PreprocessResult(standard_id="ACT-01", outcome=Outcome.DEFER)


# ═══════════════════════════════════════════════════════════════════════
# Proofing checks (PRF): typography and formatting errors
# ═══════════════════════════════════════════════════════════════════════

def check_prf01_double_spaces(text: str) -> PreprocessResult:
    """PRF-01: Flag multiple consecutive spaces between words.

    Exception: padded pipe separators in data displays (e.g., "63.6%  |  4.7M")
    are intentional formatting. Added from Opendoor triage Cluster 2.
    """
    cleaned = _DATA_DISPLAY_PIPE.sub("|", text)

    if re.search(r"[^\n] {2,}[^\n]", cleaned):
        return PreprocessResult(
            standard_id="PRF-01",
            outcome=Outcome.VIOLATION,
            issue="Double space between words.",
            suggestion="Use a single space between words.",
        )
    return PreprocessResult(standard_id="PRF-01", outcome=Outcome.PASS)


def check_prf02_repeated_words(text: str) -> PreprocessResult:
    """PRF-02: Flag immediately repeated words ('the the', 'and and')."""
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
    """PRF-03: Flag periods at the end of headings and button labels."""
    if content_type not in ("heading", "button_cta", "ui_label"):
        return PreprocessResult(standard_id="PRF-03", outcome=Outcome.DEFER)

    stripped = text.rstrip()
    if stripped.endswith(".") and not stripped.endswith("..."):
        # The suggestion is the corrected string itself (period removed),
        # not prose advice. Renderers that show before/after diffs can
        # visualize the change directly; renderers that show plain text
        # display a clean fixed version. See the 2026-05-08 design pass.
        return PreprocessResult(
            standard_id="PRF-03",
            outcome=Outcome.VIOLATION,
            issue=f"Trailing period on a {content_type.replace('_', ' ')}.",
            suggestion=stripped[:-1],
        )
    return PreprocessResult(standard_id="PRF-03", outcome=Outcome.PASS)


def check_prf04_straight_quotes(text: str, content_type: str) -> PreprocessResult:
    """PRF-04: Flag straight quotes in published copy.

    Exceptions:
        - Developer-facing content (tooltip_microcopy)
        - Contractions and possessives (system/font issue, not content design)
        - Measurement notation: digit + straight double quote = inches (13", 15.6")
          Common in product specs. Added from Apple eval.
    """
    developer_types = ("tooltip_microcopy",)
    if content_type in developer_types:
        return PreprocessResult(standard_id="PRF-04", outcome=Outcome.DEFER)

    text_without_code = re.sub(r"`[^`]+`", "", text)
    text_without_code = re.sub(r"<[^>]+>", "", text_without_code)

    # Strip measurement inch marks before checking (e.g., 13", 15.6", 27")
    text_without_inches = re.sub(r'(\d)"', r"\1", text_without_code)

    has_straight_single = "'" in text_without_inches
    has_straight_double = '"' in text_without_inches

    if has_straight_single or has_straight_double:
        text_without_contractions = re.sub(r"\w'\w", "", text_without_inches)
        text_without_possessives = re.sub(r"\w's\b", "", text_without_contractions)

        remaining_straight_single = "'" in text_without_possessives
        remaining_straight_double = '"' in text_without_inches

        if remaining_straight_single or remaining_straight_double:
            return PreprocessResult(
                standard_id="PRF-04",
                outcome=Outcome.VIOLATION,
                issue="Straight quotes in published copy.",
                suggestion="Use curly quotes (\u2018 \u2019 \u201c \u201d) instead of straight quotes (' \").",
            )

    return PreprocessResult(standard_id="PRF-04", outcome=Outcome.PASS)


def check_prf05_missing_space_after_punctuation(text: str) -> PreprocessResult:
    """PRF-05: Flag missing space after sentence-ending punctuation."""
    cleaned = re.sub(r"https?://\S+", "", text)
    cleaned = re.sub(r"\S+@\S+\.\S+", "", cleaned)
    cleaned = re.sub(r"\b(a\.m|p\.m|e\.g|i\.e|vs|Dr|Mr|Mrs|Ms|Jr|Sr|St)\.", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\d+\.\d+", "", cleaned)
    cleaned = re.sub(r"\.(pdf|doc|docx|xls|xlsx|csv|txt|html|css|js|json|png|jpg|jpeg|gif|svg|zip|xml|yaml|yml|md)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\.{3}", "", cleaned)

    if re.search(r"[.!?][A-Za-z]", cleaned):
        return PreprocessResult(
            standard_id="PRF-05",
            outcome=Outcome.VIOLATION,
            issue="Missing space after punctuation.",
            suggestion="Add a space after the period, exclamation mark, or question mark.",
        )
    return PreprocessResult(standard_id="PRF-05", outcome=Outcome.PASS)


def check_prf06_leading_trailing_whitespace(text: str) -> PreprocessResult:
    """PRF-06: Flag leading or trailing whitespace in UI copy."""
    if text != text.strip():
        # The suggestion is the trimmed string itself, so the renderer
        # can show a real before/after diff highlighting where the
        # whitespace sits. See the 2026-05-08 design pass.
        return PreprocessResult(
            standard_id="PRF-06",
            outcome=Outcome.VIOLATION,
            issue="Leading or trailing whitespace.",
            suggestion=text.strip(),
        )
    return PreprocessResult(standard_id="PRF-06", outcome=Outcome.PASS)


def check_prf07_space_before_punctuation(text: str) -> PreprocessResult:
    """PRF-07: Flag spaces before punctuation marks."""
    cleaned = re.sub(r"\s*\.{3}", "", text)

    if re.search(r"\s+[.,;:!?]", cleaned):
        return PreprocessResult(
            standard_id="PRF-07",
            outcome=Outcome.VIOLATION,
            issue="Space before punctuation mark.",
            suggestion="Remove the space before the punctuation.",
        )
    return PreprocessResult(standard_id="PRF-07", outcome=Outcome.PASS)


def check_prf08_placeholder_text(text: str) -> PreprocessResult:
    """PRF-08: Flag lorem ipsum, dev markers, and bracket placeholders."""
    if re.search(r"lorem ipsum", text, re.IGNORECASE):
        return PreprocessResult(
            standard_id="PRF-08",
            outcome=Outcome.VIOLATION,
            issue="Lorem ipsum placeholder text.",
            suggestion="Replace with real copy before shipping.",
        )

    # Dev markers: only match uppercase to avoid false positives
    if (re.search(r"\b(TODO|FIXME|PLACEHOLDER|WIP)\b", text)
            or re.match(r"(TBD|DRAFT)\b", text)
            or (re.search(r"\b(TBD|DRAFT)\b", text) and text == text.upper())):
        match = re.search(r"\b(TODO|FIXME|TBD|PLACEHOLDER|WIP|DRAFT)\b", text)
        if match:
            return PreprocessResult(
                standard_id="PRF-08",
                outcome=Outcome.VIOLATION,
                issue=f"Dev marker '{match.group(0)}' in UI copy.",
                suggestion="Replace with final copy before shipping.",
            )

    # Bracket placeholders: [insert X], [your X here], etc.
    if re.search(r"\[(insert|your|replace|enter|add|placeholder|text|TBD)[^\]]*\]", text, re.IGNORECASE):
        return PreprocessResult(
            standard_id="PRF-08",
            outcome=Outcome.VIOLATION,
            issue="Bracket placeholder in UI copy.",
            suggestion="Replace the bracketed placeholder with final copy.",
        )

    return PreprocessResult(standard_id="PRF-08", outcome=Outcome.PASS)


def check_prf09_all_caps(text: str) -> PreprocessResult:
    """PRF-09: Flag ALL CAPS words (4+ letters) that aren't known acronyms."""
    caps_words = re.findall(r"\b[A-Z]{4,}\b", text)
    if not caps_words:
        return PreprocessResult(standard_id="PRF-09", outcome=Outcome.PASS)

    unknown = [w for w in caps_words if w not in KNOWN_ACRONYMS]
    if not unknown:
        return PreprocessResult(standard_id="PRF-09", outcome=Outcome.PASS)

    return PreprocessResult(
        standard_id="PRF-09",
        outcome=Outcome.VIOLATION,
        issue=f"ALL CAPS text: '{unknown[0]}'. Use sentence case instead.",
        suggestion="Rewrite in sentence case. ALL CAPS reduces readability and can feel like shouting.",
    )


def check_prf10_latin_abbreviations(text: str, content_type: str) -> PreprocessResult:
    """PRF-10: Flag Latin abbreviations (e.g., i.e., etc.) for accessibility."""
    if content_type == "tooltip_microcopy":
        return PreprocessResult(standard_id="PRF-10", outcome=Outcome.DEFER)

    latin_match = re.search(r"\b(e\.g\.|i\.e\.|etc\.)", text, re.IGNORECASE)
    if latin_match:
        found = latin_match.group(1).lower()
        replacements = {"e.g.": "for example", "i.e.": "that is", "etc.": "and so on"}
        replacement = replacements.get(found, "the full phrase")
        return PreprocessResult(
            standard_id="PRF-10",
            outcome=Outcome.VIOLATION,
            issue=f"Latin abbreviation '{found}' — use '{replacement}' instead.",
            suggestion=f"Replace '{found}' with '{replacement}' for accessibility and clarity.",
        )

    return PreprocessResult(standard_id="PRF-10", outcome=Outcome.PASS)


def check_prf11_dismissive_language(text: str, content_type: str) -> PreprocessResult:
    """PRF-11: Flag 'simply', 'easily', 'just + verb' in instructional content."""
    flaggable_types = frozenset({
        "error_message", "tooltip_microcopy", "short_ui_copy",
        "long_form_copy", "confirmation",
    })
    if content_type not in flaggable_types:
        return PreprocessResult(standard_id="PRF-11", outcome=Outcome.DEFER)

    match = (
        re.search(r"\b(simply|easily|effortlessly)\b", text, re.IGNORECASE)
        or re.search(
            r"\b(just)\s+(click|tap|select|enter|type|press|go|follow|add|open|use|do|drag|set)\b",
            text, re.IGNORECASE,
        )
    )
    if match:
        word = match.group(0)
        return PreprocessResult(
            standard_id="PRF-11",
            outcome=Outcome.VIOLATION,
            issue=f"'{word}' can feel dismissive — it implies the task is trivial when the user may be struggling.",
            suggestion="Remove the word. 'Select your plan' is clearer than 'Simply select your plan.'",
        )

    adjective_match = re.search(
        r"\b(simple|easy)\s+(to|way|steps?|process|setup|method|task|fix|solution|guide)\b",
        text, re.IGNORECASE,
    )
    if adjective_match:
        return PreprocessResult(
            standard_id="PRF-11",
            outcome=Outcome.VIOLATION,
            issue=f"'{adjective_match.group(1)}' can feel dismissive — remove it and let the simplicity speak for itself.",
            suggestion=f"Instead of '{adjective_match.group(0)}', describe the action directly. 'Set up in 3 steps' is more credible than 'Easy setup.'",
        )

    return PreprocessResult(standard_id="PRF-11", outcome=Outcome.DEFER)


# ═══════════════════════════════════════════════════════════════════════
# Accessibility and clarity checks
# ═══════════════════════════════════════════════════════════════════════

# ---------------------------------------------------------------------------
# ACC-08: Device-specific verbs (v4.7.1) — shape detection at conf 0.65
# ---------------------------------------------------------------------------
#
# Detects "touch", "tap", "click", "hover", "swipe" (and common
# inflections) as candidates for device-neutral rewrites. Audience-aware:
# native_mobile audience PASSes unconditionally because device-specific
# verbs are appropriate to the platform's input model. ACC-01 owns the
# literal "click here" / "tap here" link-text patterns (Conflict 5),
# so ACC-08 DEFERs when those substrings are present.

_ACC08_DEVICE_VERB_RE = re.compile(
    r"\b(touch|tap|click|hover|swipe)(ed|ing|s|es)?\b",
    re.IGNORECASE,
)


def check_acc08_device_verbs(
    text: str, audience: Audience,
) -> PreprocessResult:
    """ACC-08: Detect device-specific verbs that imply an input method.

    Shape detection at confidence 0.65. Routes through derive_verdict
    to `review_recommended` (soft surface), with soft-guidance voice in
    issue/suggestion text. The user is given agency: keep the verb if
    it's intentional (platform-specific copy, button name); take the
    rewrite if device-neutral phrasing fits.
    """
    if audience == Audience.NATIVE_MOBILE:
        return PreprocessResult(standard_id="ACC-08", outcome=Outcome.PASS)

    text_lower = text.lower()
    # Conflict 5: ACC-01 owns "click here" / "tap here" — defer those.
    if "click here" in text_lower or "tap here" in text_lower:
        return PreprocessResult(standard_id="ACC-08", outcome=Outcome.DEFER)

    match = _ACC08_DEVICE_VERB_RE.search(text)
    if match:
        verb = match.group(0)
        return PreprocessResult(
            standard_id="ACC-08",
            outcome=Outcome.VIOLATION,
            issue=(
                f"ContentRX noticed '{verb}' here — could be intentional "
                f"for a platform-specific surface or a button name. If "
                f"it is, keep it."
            ),
            suggestion=(
                f"If you wanted device-neutral copy, try 'select' or "
                f"'open' instead of '{verb}'."
            ),
            confidence=0.65,
        )
    return PreprocessResult(standard_id="ACC-08", outcome=Outcome.DEFER)


def check_acc01_vague_link_text(text: str) -> PreprocessResult:
    """ACC-01: Flag 'click here', 'learn more', and other non-descriptive link text."""
    lower = text.lower().strip()

    banned_exact = [
        "click here", "tap here", "click here.", "tap here.",
        "click here!", "tap here!",
    ]
    if lower in banned_exact:
        return PreprocessResult(
            standard_id="ACC-01",
            outcome=Outcome.VIOLATION,
            issue="'Click here' is non-descriptive link text.",
            suggestion="Describe the destination or action: 'View billing details' instead of 'Click here.'",
        )

    if re.search(r"\bclick here\b", text, re.IGNORECASE) or re.search(r"\btap here\b", text, re.IGNORECASE):
        return PreprocessResult(
            standard_id="ACC-01",
            outcome=Outcome.VIOLATION,
            issue="Contains 'click here' — use descriptive link text instead.",
            suggestion="Replace 'click here' with text that describes what the user will find.",
        )

    vague_phrases = ["read more", "learn more", "more info", "find out more"]
    if lower in vague_phrases:
        return PreprocessResult(
            standard_id="ACC-01",
            outcome=Outcome.VIOLATION,
            issue=f"'{text}' is non-descriptive link text.",
            suggestion="Describe the destination: 'Read our pricing guide' instead of 'Read more.'",
        )

    if re.search(r"^(read more|learn more|more info)\b", lower, re.IGNORECASE):
        return PreprocessResult(
            standard_id="ACC-01",
            outcome=Outcome.VIOLATION,
            issue="Starts with non-descriptive link text.",
            suggestion="Lead with specific context: 'Explore billing options' instead of 'Learn more about billing.'",
        )

    return PreprocessResult(standard_id="ACC-01", outcome=Outcome.DEFER)


# ---------------------------------------------------------------------------
# CLR-03: Sentence-length thresholds (v4.7.1)
# ---------------------------------------------------------------------------
#
# Per-content-type thresholds. The plan tightens short_ui_copy /
# tooltip_microcopy / error_message from 25 → 20 words; long_form_copy
# stays at 25. Heading-style content (button_cta, ui_label, heading,
# confirmation) is exempt from this check — those are short by definition
# and judged by their own standards (ACT-01, CON-02).

_CLR03_SHORT_THRESHOLD = 20
_CLR03_DEFAULT_THRESHOLD = 25
_CLR03_SHORT_TYPES = frozenset({
    "short_ui_copy", "tooltip_microcopy", "error_message",
})
_CLR03_EXEMPT_TYPES = frozenset({
    "button_cta", "ui_label", "heading", "confirmation",
})


def check_clr03_sentence_length(
    text: str, content_type: str,
) -> PreprocessResult:
    """CLR-03: Flag sentences over the per-content-type word-count threshold.

    Factual detection at confidence 1.0. The LLM is inconsistent at
    counting words; deterministic counting removes a class of false
    negatives that beta users would otherwise notice.

    Thresholds (v4.7.1):
        short_ui_copy / tooltip_microcopy / error_message: 20 words
        long_form_copy and others: 25 words
        button_cta / ui_label / heading / confirmation: exempt (DEFER)
    """
    if content_type in _CLR03_EXEMPT_TYPES:
        return PreprocessResult(standard_id="CLR-03", outcome=Outcome.DEFER)

    threshold = (
        _CLR03_SHORT_THRESHOLD
        if content_type in _CLR03_SHORT_TYPES
        else _CLR03_DEFAULT_THRESHOLD
    )

    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    for sentence in sentences:
        words = [w for w in sentence.split() if w.strip()]
        if len(words) > threshold:
            return PreprocessResult(
                standard_id="CLR-03",
                outcome=Outcome.VIOLATION,
                issue=(
                    f"Sentence is {len(words)} words. Aim for under "
                    f"{threshold} for "
                    f"{content_type.replace('_', ' ')}."
                ),
                suggestion=(
                    "Split into shorter sentences. Look for natural "
                    "breaks after coordinating conjunctions ('and', "
                    "'but', 'because') or before a new clause."
                ),
                confidence=1.0,
            )
    return PreprocessResult(standard_id="CLR-03", outcome=Outcome.PASS)


def check_clr01_redundant_phrases(text: str) -> PreprocessResult:
    """CLR-01: Flag wordy phrases with universally simpler replacements."""
    phrases = [
        (r"\bin order to\b", "to"),
        (r"\bwhether or not\b", "whether"),
        (r"\bdue to the fact that\b", "because"),
        (r"\bat this point in time\b", "now"),
        (r"\bat this time\b", "now"),
        (r"\bhas the ability to\b", "can"),
        (r"\bis able to\b", "can"),
        (r"\bare able to\b", "can"),
        (r"\bin the event that\b", "if"),
        (r"\bprior to\b", "before"),
        (r"\bsubsequent to\b", "after"),
        (r"\bin regard to\b", "about"),
        (r"\bwith regard to\b", "about"),
        (r"\bin regards to\b", "about"),
        (r"\bfor the purpose of\b", "to"),
        (r"\bon a daily basis\b", "daily"),
        (r"\bon a regular basis\b", "regularly"),
        (r"\ba large number of\b", "many"),
        (r"\ba majority of\b", "most"),
        (r"\bin close proximity to?\b", "near"),
        (r"\bdespite the fact that\b", "although"),
        (r"\bat the present time\b", "now"),
    ]

    for pattern, replacement in phrases:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return PreprocessResult(
                standard_id="CLR-01",
                outcome=Outcome.VIOLATION,
                issue=f"Wordy phrase: '{match.group(0)}'. Use '{replacement}' instead.",
                suggestion=f"Replace '{match.group(0)}' with '{replacement}'.",
            )

    return PreprocessResult(standard_id="CLR-01", outcome=Outcome.DEFER)


def check_clr01_banned_words(text: str) -> PreprocessResult:
    """CLR-01: Flag unnecessarily complex words with simpler alternatives."""
    banned = [
        (r"\butilize[sd]?\b", "use"),
        (r"\butilization\b", "use"),
        (r"\bleverage[sd]?\b", "use"),
        (r"\bfacilitate[sd]?\b", "help"),
        (r"\bcommence[sd]?\b", "start"),
        (r"\bterminate[sd]?\b", "end"),
        (r"\baforementioned\b", "this"),
        (r"\bherein\b", "(remove)"),
        (r"\btherein\b", "(remove)"),
        (r"\bhenceforth\b", "from now on"),
        (r"\bnotwithstanding\b", "despite"),
        (r"\bheretofore\b", "until now"),
        (r"\bwhereby\b", "where"),
        (r"\bwherein\b", "where"),
        (r"\binasmuch\b", "because"),
    ]

    for pattern, replacement in banned:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return PreprocessResult(
                standard_id="CLR-01",
                outcome=Outcome.VIOLATION,
                issue=f"'{match.group(0)}' — use '{replacement}' instead.",
                suggestion=f"Replace '{match.group(0)}' with '{replacement}'.",
            )

    return PreprocessResult(standard_id="CLR-01", outcome=Outcome.DEFER)


# ═══════════════════════════════════════════════════════════════════════
# Inclusion checks
# ═══════════════════════════════════════════════════════════════════════

def check_inc01_gendered_language(text: str) -> PreprocessResult:
    """INC-01: Flag gendered terms with gender-neutral alternatives."""
    gendered = [
        (r"\bchairman\b", "chair or chairperson"),
        (r"\bchairmen\b", "chairs or chairpeople"),
        (r"\bmankind\b", "humanity or people"),
        (r"\bmanpower\b", "workforce or staffing"),
        (r"\bmanmade\b", "synthetic or artificial"),
        (r"\bman-made\b", "synthetic or artificial"),
        (r"\bfireman\b", "firefighter"),
        (r"\bfiremen\b", "firefighters"),
        (r"\bpoliceman\b", "police officer"),
        (r"\bpolicemen\b", "police officers"),
        (r"\bsalesman\b", "salesperson"),
        (r"\bsalesmen\b", "salespeople"),
        (r"\bstewardess\b", "flight attendant"),
        (r"\bwaitress\b", "server"),
        (r"\bmailman\b", "mail carrier"),
        (r"\bcongressman\b", "representative"),
        (r"\bbusinessmen\b", "businesspeople"),
        (r"\bhe/she\b", "they"),
        (r"\bhis/her\b", "their"),
        (r"\bhis or her\b", "their"),
        (r"\bhe or she\b", "they"),
    ]

    for pattern, suggestion in gendered:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return PreprocessResult(
                standard_id="INC-01",
                outcome=Outcome.VIOLATION,
                issue=f"Gendered term: '{match.group(0)}'. Use gender-neutral language.",
                suggestion=f"Replace '{match.group(0)}' with '{suggestion}'.",
            )

    return PreprocessResult(standard_id="INC-01", outcome=Outcome.DEFER)


def check_inc02_non_inclusive_tech(text: str) -> PreprocessResult:
    """INC-02: Flag non-inclusive technical terminology.

    'master' is only flagged in tech-specific compounds to avoid
    false positives on 'master's degree' or 'masterful'.
    """
    terms = [
        (r"\bwhitelist(?:ed|ing|s)?\b", "allow list"),
        (r"\bblacklist(?:ed|ing|s)?\b", "block list or deny list"),
        (r"\bmaster\b", "main, primary, or source"),
        (r"\bslave\b", "replica, secondary, or worker"),
        (r"\bgrandfathered\b", "legacy or exempt"),
    ]

    for pattern, suggestion in terms:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            # "master" needs extra context gating
            if re.match(r"^master$", match.group(0), re.IGNORECASE):
                lower = text.lower()
                tech_context = (
                    re.search(r"master\s+(branch|node|server|database|db|slave|copy|record)", lower)
                    or re.search(r"\b(git|push to|merge to|pull from)\s+master\b", lower)
                )
                if tech_context:
                    return PreprocessResult(
                        standard_id="INC-02",
                        outcome=Outcome.VIOLATION,
                        issue=f"Non-inclusive term: '{match.group(0)}'. Use '{suggestion}' instead.",
                        suggestion=f"Replace '{match.group(0)}' with '{suggestion}'.",
                    )
                return PreprocessResult(standard_id="INC-02", outcome=Outcome.DEFER)

            return PreprocessResult(
                standard_id="INC-02",
                outcome=Outcome.VIOLATION,
                issue=f"Non-inclusive term: '{match.group(0)}'. Use '{suggestion}' instead.",
                suggestion=f"Replace '{match.group(0)}' with '{suggestion}'.",
            )

    return PreprocessResult(standard_id="INC-02", outcome=Outcome.DEFER)


# ═══════════════════════════════════════════════════════════════════════
# Main entry point
# ═══════════════════════════════════════════════════════════════════════

def preprocess(
    text: str,
    content_type: str,
    audience: Audience = Audience.PRODUCT_UI,
) -> list[PreprocessResult]:
    """Run all deterministic checks on a piece of content.

    Args:
        text: The content to check.
        content_type: The classified content type (heading, ui_label, etc.).
        audience: The audience mode (PRODUCT_UI / NATIVE_MOBILE / GENERAL).
            Threaded into ACC-08; other checks ignore it.

    Returns:
        List of PreprocessResult objects. Each result covers one standard
        with an outcome of VIOLATION, PASS, or DEFER.
    """
    results = []

    # Standards-based checks
    results.append(check_grm01_oxford_comma(text))
    results.append(check_grm02_abbreviations(text))
    results.append(check_grm03_exclamation_points(text))
    results.append(check_grm04_ampersands(text, content_type))
    results.append(check_grm05_numerals(text))
    results.append(check_grm06_compound_modifiers(text))
    results.append(check_con03_date_formats(text))
    results.append(check_con02_sentence_case(text))
    results.append(check_con02_strict_headings(text, content_type))
    results.append(check_act01_binary_responses(text))

    # Proofing checks
    results.append(check_prf01_double_spaces(text))
    results.append(check_prf02_repeated_words(text))
    results.append(check_prf03_trailing_period_on_headings(text, content_type))
    results.append(check_prf04_straight_quotes(text, content_type))
    results.append(check_prf05_missing_space_after_punctuation(text))
    results.append(check_prf06_leading_trailing_whitespace(text))
    results.append(check_prf07_space_before_punctuation(text))
    results.append(check_prf08_placeholder_text(text))
    results.append(check_prf09_all_caps(text))
    results.append(check_prf10_latin_abbreviations(text, content_type))
    results.append(check_prf11_dismissive_language(text, content_type))

    # Accessibility, clarity, inclusion
    results.append(check_acc01_vague_link_text(text))
    results.append(check_acc08_device_verbs(text, audience))
    results.append(check_clr01_redundant_phrases(text))
    results.append(check_clr01_banned_words(text))
    results.append(check_clr03_sentence_length(text, content_type))
    results.append(check_inc01_gendered_language(text))
    results.append(check_inc02_non_inclusive_tech(text))

    return results


def get_preprocess_violations(results: list[PreprocessResult]) -> list[dict]:
    """Extract violations from preprocess results as dicts."""
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
    """Get the set of standard IDs that the preprocessor definitively passed."""
    return {r.standard_id for r in results if r.is_pass}


# ---------------------------------------------------------------------------
# Package integration: run_preprocess() returns Violation objects
# ---------------------------------------------------------------------------

def run_preprocess(
    text: str,
    content_type: str = "short_ui_copy",
    audience: Audience | str = Audience.PRODUCT_UI,
):
    """Run all deterministic checks and return violations as Violation objects.

    This is the entry point used by pipeline.py.

    `audience` is threaded into ACC-08 only; other checks ignore it.
    Most call sites that built before the audience parameter existed get
    the safe PRODUCT_UI default — full enforcement.

    Per-result confidence: factual detections emit at 1.0 (default);
    shape detections (CON-02 strict headings, ACC-08 device verbs) emit
    at 0.65, which routes through derive_verdict to `review_recommended`
    rather than a hard `violation` verdict.
    """
    if isinstance(audience, str):
        audience = Audience.from_str(audience)

    results = preprocess(text, content_type, audience=audience)
    suppressed = get_suppressed_standards(results)

    try:
        from content_checker.models import Violation
    except ImportError:
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
                confidence=r.confidence,
            ))

    violations = _ViolationList(violations, suppressed)
    return violations


class _ViolationList(list):
    """A list that also carries suppressed standard IDs."""

    def __init__(self, violations, suppressed_ids):
        super().__init__(violations)
        self.suppressed_ids = suppressed_ids
