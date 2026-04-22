"""Preprocessor tests — organized by standard ID.

Consolidated from 7 session files (M2 complete, v4.6.0):
    - test_preprocess.py (original)
    - test_preprocess_phase2.py
    - test_preprocess_phase3.py
    - test_apple_patches.py (preprocessor classes only)
    - test_v442_patches.py (preprocessor classes only)
    - test_v450_patches.py (preprocessor classes only)
    - test_triage_fixes.py (preprocessor classes only)

Organization:
    Grammar:       GRM-01 through GRM-06
    Convention:    CON-02, CON-03
    Proofing:      PRF-01 through PRF-11
    Clarity:       CLR-01
    Accessibility: ACC-01
    Inclusion:     INC-01, INC-02
    Action:        ACT-01
    Legal routing: Legal content detection
    Real-world:    Regression cases from eval data
    Integration:   Check count, pipeline wiring

Tests within each standard: VIOLATION first, PASS second, DEFER third,
edge cases last.

Run: python -m pytest tests/test_preprocess.py -v
"""

import pytest
from content_checker.preprocess import (
    Outcome,
    PreprocessResult,
    check_acc01_vague_link_text,
    check_act01_binary_responses,
    check_clr01_banned_words,
    check_clr01_redundant_phrases,
    check_con02_sentence_case,
    check_con03_date_formats,
    check_grm01_oxford_comma,
    check_grm02_abbreviations,
    check_grm03_exclamation_points,
    check_grm04_ampersands,
    check_grm05_numerals,
    check_grm06_compound_modifiers,
    check_inc01_gendered_language,
    check_inc02_non_inclusive_tech,
    check_prf01_double_spaces,
    check_prf02_repeated_words,
    check_prf03_trailing_period_on_headings,
    check_prf04_straight_quotes,
    check_prf05_missing_space_after_punctuation,
    check_prf06_leading_trailing_whitespace,
    check_prf07_space_before_punctuation,
    check_prf08_placeholder_text,
    check_prf09_all_caps,
    check_prf10_latin_abbreviations,
    check_prf11_dismissive_language,
    get_preprocess_violations,
    get_suppressed_standards,
    preprocess,
    CON02_SAFE_PHRASES,
    _DATA_DISPLAY_PIPE,
)


# ═══════════════════════════════════════════════════════════════════════
# Grammar checks
# ═══════════════════════════════════════════════════════════════════════


# --- GRM-01: Oxford comma ---


class TestGRM01OxfordComma:
    """Missing Oxford comma in a clear 3+ item list = violation.

    Source: test_preprocess.py
    """

    def test_missing_oxford_comma_violation(self):
        r = check_grm01_oxford_comma(
            "You can track orders, manage returns and contact support."
        )
        assert r.outcome == Outcome.VIOLATION

    def test_missing_oxford_comma_with_or(self):
        r = check_grm01_oxford_comma(
            "Choose from email, phone or live chat."
        )
        assert r.outcome == Outcome.VIOLATION

    def test_oxford_comma_present_defers(self):
        """Correct lists defer — the LLM confirms the pass."""
        r = check_grm01_oxford_comma(
            "You can track orders, manage returns, and contact support."
        )
        assert r.outcome == Outcome.DEFER

    def test_two_item_list_defers(self):
        """Two-item lists don't need an Oxford comma."""
        r = check_grm01_oxford_comma(
            "You can track orders and manage returns."
        )
        assert r.outcome == Outcome.DEFER

    def test_no_list_defers(self):
        r = check_grm01_oxford_comma("Your order shipped.")
        assert r.outcome == Outcome.DEFER


# --- GRM-02: Abbreviation allowlist (pass-only) ---


class TestGRM02Abbreviations:
    """Known abbreviations pass. Unknown ones defer. Never flags violations.

    Source: test_preprocess.py
    """

    def test_known_abbreviation_pass(self):
        r = check_grm02_abbreviations("Enter your ZIP code.")
        assert r.outcome == Outcome.PASS

    def test_multiple_known_abbreviations_pass(self):
        r = check_grm02_abbreviations("Use the API to generate a PDF.")
        assert r.outcome == Outcome.PASS

    def test_tty_accessibility_pass(self):
        r = check_grm02_abbreviations("Call us (TTY 711).")
        assert r.outcome == Outcome.PASS

    def test_llc_business_pass(self):
        r = check_grm02_abbreviations("LLC, partnership, or corporation")
        assert r.outcome == Outcome.PASS

    def test_known_sso_abbreviation_passes(self):
        """SSO is on the common-knowledge allowlist."""
        r = check_grm02_abbreviations("We use SSO across all products.")
        assert r.outcome == Outcome.PASS

    def test_truly_unknown_abbreviation_defers(self):
        r = check_grm02_abbreviations("Configure the XYZZY protocol.")
        assert r.outcome == Outcome.DEFER

    def test_internal_abbreviation_defers(self):
        """Internal abbreviations should be caught by LLM."""
        r = check_grm02_abbreviations("About KP")
        assert r.outcome == Outcome.DEFER

    def test_no_abbreviations_defers(self):
        r = check_grm02_abbreviations("Your order shipped today.")
        assert r.outcome == Outcome.DEFER

    def test_never_flags_violation(self):
        """The preprocessor must NEVER flag an abbreviation as a violation."""
        r = check_grm02_abbreviations("Configure the XYZZY protocol.")
        assert r.outcome != Outcome.VIOLATION


# --- GRM-03: Exclamation points ---


class TestGRM03ExclamationPoints:
    """Multiple exclamation marks are always a violation. Single marks defer.

    Source: test_preprocess.py
    """

    def test_double_exclamation_violation(self):
        r = check_grm03_exclamation_points("Welcome to your dashboard!!")
        assert r.outcome == Outcome.VIOLATION

    def test_triple_exclamation_violation(self):
        r = check_grm03_exclamation_points("You did it!!!")
        assert r.outcome == Outcome.VIOLATION

    def test_single_exclamation_defers(self):
        """Single exclamation marks are a judgment call for the LLM."""
        r = check_grm03_exclamation_points("Welcome to your dashboard!")
        assert r.outcome == Outcome.DEFER

    def test_no_exclamation_defers(self):
        r = check_grm03_exclamation_points("Welcome to your dashboard.")
        assert r.outcome == Outcome.DEFER

    def test_exclamation_in_middle(self):
        r = check_grm03_exclamation_points("Wow!! That was fast.")
        assert r.outcome == Outcome.VIOLATION


# --- GRM-04: Ampersands (content-type-aware) ---


class TestGRM04Ampersands:
    """Ampersands in body copy = violation. In headings/nav = pass.

    Source: test_preprocess.py
    """

    # --- Violations (body copy) ---

    def test_ampersand_in_body_copy_violation(self):
        r = check_grm04_ampersands(
            "Read our terms & conditions for more details.",
            "short_ui_copy",
        )
        assert r.outcome == Outcome.VIOLATION

    def test_ampersand_in_long_form_violation(self):
        r = check_grm04_ampersands(
            "We offer reporting & analytics for all accounts.",
            "long_form_copy",
        )
        assert r.outcome == Outcome.VIOLATION

    def test_ampersand_in_tooltip_violation(self):
        r = check_grm04_ampersands(
            "View sales & revenue data here.",
            "tooltip_microcopy",
        )
        assert r.outcome == Outcome.VIOLATION

    # --- Passes (space-constrained elements) ---

    def test_ampersand_in_heading_pass(self):
        r = check_grm04_ampersands("Products & pricing", "heading")
        assert r.outcome == Outcome.PASS

    def test_ampersand_in_nav_pass(self):
        r = check_grm04_ampersands("Doctors & Locations", "ui_label")
        assert r.outcome == Outcome.PASS

    def test_ampersand_in_button_pass(self):
        r = check_grm04_ampersands("Save & continue", "button_cta")
        assert r.outcome == Outcome.PASS

    # --- Brand name exceptions ---

    def test_att_brand_pass(self):
        r = check_grm04_ampersands("Powered by AT&T", "short_ui_copy")
        assert r.outcome == Outcome.PASS

    def test_hm_brand_pass(self):
        r = check_grm04_ampersands("Shop the H&M collection", "short_ui_copy")
        assert r.outcome == Outcome.PASS

    def test_sp_brand_pass(self):
        r = check_grm04_ampersands("S&P 500 index data", "long_form_copy")
        assert r.outcome == Outcome.PASS

    # --- No ampersand = pass ---

    def test_no_ampersand_pass(self):
        r = check_grm04_ampersands("Terms and conditions", "short_ui_copy")
        assert r.outcome == Outcome.PASS

    # --- HTML entities are not ampersands ---

    def test_html_entity_not_flagged(self):
        r = check_grm04_ampersands("Tom &amp; Jerry", "short_ui_copy")
        assert r.outcome == Outcome.PASS

    # --- Unknown content type defers ---

    def test_unknown_content_type_defers(self):
        r = check_grm04_ampersands("This & that", "unknown_type")
        assert r.outcome == Outcome.DEFER


# --- GRM-05: Numerals vs. spelled-out numbers ---


class TestGRM05Numerals:
    """Spelled-out numbers in body copy = violation, with escape hatches.

    Source: test_preprocess.py
    """

    def test_spelled_out_number_violation(self):
        r = check_grm05_numerals(
            "You have two new notifications and five pending requests."
        )
        assert r.outcome == Outcome.VIOLATION

    def test_spelled_out_three_violation(self):
        r = check_grm05_numerals("Add three more items to your cart.")
        assert r.outcome == Outcome.VIOLATION

    # --- Escape hatches ---

    def test_sentence_start_pass(self):
        """Numbers at the start of a sentence are correctly spelled out."""
        r = check_grm05_numerals("Twelve users are currently online.")
        assert r.outcome == Outcome.PASS

    def test_number_one_as_rank_safe(self):
        """'number one' as a rank/title is not a violation."""
        r = check_grm05_numerals("Ranked number one in value.")
        assert r.outcome == Outcome.DEFER  # "one" removed by safe phrase filter

    def test_one_of_safe_phrase(self):
        r = check_grm05_numerals("This is one of the best features.")
        assert r.outcome == Outcome.DEFER

    def test_no_one_safe_phrase(self):
        r = check_grm05_numerals("No one has reported this issue.")
        assert r.outcome == Outcome.DEFER

    def test_two_factor_safe_phrase(self):
        r = check_grm05_numerals("Enable two-factor authentication.")
        assert r.outcome == Outcome.VIOLATION  # "two" mid-sentence, not in safe phrases

    def test_numeral_present_defers(self):
        """Already using numerals — nothing to flag."""
        r = check_grm05_numerals("You have 3 new messages.")
        assert r.outcome == Outcome.DEFER

    def test_no_numbers_defers(self):
        r = check_grm05_numerals("Your account is ready.")
        assert r.outcome == Outcome.DEFER


class TestGrm05PronounOne:
    """'One' in compound phrases and specific product contexts is not numerical.

    Source: test_apple_patches.py
    """

    # --- Safe contexts (should NOT violate) ---

    def test_one_on_one(self):
        r = check_grm05_numerals("Schedule a one on one meeting")
        assert r.outcome != Outcome.VIOLATION

    def test_one_on_one_hyphenated(self):
        r = check_grm05_numerals("Book a one-on-one session")
        assert r.outcome != Outcome.VIOLATION

    def test_one_way(self):
        """'one way' was already in safe contexts, verify it works."""
        r = check_grm05_numerals("This is one way to do it")
        assert r.outcome != Outcome.VIOLATION

    def test_one_way_hyphenated(self):
        r = check_grm05_numerals("One-way sync is available")
        assert r.outcome != Outcome.VIOLATION

    def test_one_app(self):
        r = check_grm05_numerals("One app for all your devices")
        assert r.outcome != Outcome.VIOLATION

    def test_one_of_existing(self):
        """Regression: existing safe phrase still works."""
        r = check_grm05_numerals("One of the best features")
        assert r.outcome != Outcome.VIOLATION

    def test_no_one_existing(self):
        """Regression: 'no one' still safe."""
        r = check_grm05_numerals("No one can see your data")
        assert r.outcome != Outcome.VIOLATION

    def test_someone_existing(self):
        """Regression: 'someone' still safe."""
        r = check_grm05_numerals("Share with someone you trust")
        assert r.outcome != Outcome.VIOLATION

    def test_sentence_start_one_app(self):
        """'One app' matches safe context → DEFER (not violation, not pass)."""
        r = check_grm05_numerals("One app for everything")
        assert r.outcome != Outcome.VIOLATION
        assert r.outcome == Outcome.DEFER

    # --- Violations (still caught) ---

    def test_three_still_flags(self):
        r = check_grm05_numerals("There are three items in your cart")
        assert r.outcome == Outcome.VIOLATION

    def test_five_still_flags(self):
        r = check_grm05_numerals("Choose from five different plans")
        assert r.outcome == Outcome.VIOLATION

    def test_ten_still_flags(self):
        r = check_grm05_numerals("We support ten languages")
        assert r.outcome == Outcome.VIOLATION


class TestGrm05UnicodeHyphens:
    """U+2011 (non-breaking hyphen) and U+2010 (hyphen) should match
    safe contexts that use U+002D (hyphen-minus).

    Source: test_v442_patches.py
    """

    def test_non_breaking_hyphen_one_year(self):
        """U+2011 in 'one‑year' should match safe context 'one-year'."""
        r = check_grm05_numerals("Includes one\u2011year warranty")
        assert r.outcome != Outcome.VIOLATION

    def test_hyphen_char_one_year(self):
        """U+2010 in 'one‐year' should match safe context 'one-year'."""
        r = check_grm05_numerals("Includes one\u2010year warranty")
        assert r.outcome != Outcome.VIOLATION

    def test_ascii_hyphen_one_year(self):
        """Standard ASCII hyphen still works (regression guard)."""
        r = check_grm05_numerals("Includes one-year warranty")
        assert r.outcome != Outcome.VIOLATION

    def test_non_breaking_hyphen_one_on_one(self):
        """U+2011 in 'one‑on‑one' should match safe context."""
        r = check_grm05_numerals("Schedule a one\u2011on\u2011one session")
        assert r.outcome != Outcome.VIOLATION

    def test_non_breaking_hyphen_one_way(self):
        """U+2011 in 'one‑way' should match safe context."""
        r = check_grm05_numerals("This is a one\u2011way street")
        assert r.outcome != Outcome.VIOLATION

    def test_unicode_hyphen_does_not_suppress_real_violations(self):
        """Unicode hyphens in non-safe contexts should still flag."""
        r = check_grm05_numerals("You have one\u2011hundred items left")
        assert r.outcome == Outcome.VIOLATION


class TestGrm05SafeContextAdditions:
    """New safe contexts from Apple eval: 'one year', 'one-year',
    'applecare one'.

    Source: test_v442_patches.py
    """

    def test_one_year_no_hyphen(self):
        """'one year' as a duration should pass."""
        r = check_grm05_numerals("Includes one year of coverage")
        assert r.outcome != Outcome.VIOLATION

    def test_one_year_with_hyphen(self):
        """'one-year' as a compound modifier should pass."""
        r = check_grm05_numerals("Includes one-year warranty")
        assert r.outcome != Outcome.VIOLATION

    def test_applecare_one(self):
        """'AppleCare One' as a brand name should pass."""
        r = check_grm05_numerals("Get AppleCare One for your devices")
        assert r.outcome != Outcome.VIOLATION

    def test_applecare_one_lowercase(self):
        """Case-insensitive match for 'applecare one'."""
        r = check_grm05_numerals("get applecare one today")
        assert r.outcome != Outcome.VIOLATION

    def test_existing_safe_contexts_still_work(self):
        """Regression: existing safe contexts unchanged."""
        assert check_grm05_numerals("One of the best options").outcome != Outcome.VIOLATION
        assert check_grm05_numerals("No one expected this").outcome != Outcome.VIOLATION
        assert check_grm05_numerals("one-on-one coaching").outcome != Outcome.VIOLATION
        assert check_grm05_numerals("one app for everything").outcome != Outcome.VIOLATION

    def test_bare_one_mid_sentence_still_flags(self):
        """'one' without safe context is still a violation."""
        r = check_grm05_numerals("You have one notification")
        assert r.outcome == Outcome.VIOLATION

    def test_other_numbers_unaffected(self):
        """Numbers 2-50 are not changed by these patches."""
        r = check_grm05_numerals("You have three items in your cart")
        assert r.outcome == Outcome.VIOLATION


# --- GRM-06: Compound modifier hyphenation ---


class TestGRM06NumericViolations:
    """Numeric compound modifiers without hyphens → VIOLATION.

    Source: test_v450_patches.py
    """

    def test_day_singular(self):
        r = check_grm06_compound_modifiers("5 day streak")
        assert r.is_violation
        assert "5-day" in r.suggestion

    def test_day_plural(self):
        r = check_grm06_compound_modifiers("10 days streak")
        assert r.is_violation
        assert "10-day" in r.suggestion

    def test_trial(self):
        r = check_grm06_compound_modifiers("Start your 30 day free trial")
        assert r.is_violation
        assert "30-day" in r.suggestion

    def test_hour(self):
        r = check_grm06_compound_modifiers("Join our 2 hour workshop")
        assert r.is_violation

    def test_minute(self):
        r = check_grm06_compound_modifiers("Complete the 15 minute survey")
        assert r.is_violation
        assert "15-minute" in r.suggestion

    def test_week(self):
        r = check_grm06_compound_modifiers("Your 4 week plan starts now")
        assert r.is_violation

    def test_year(self):
        r = check_grm06_compound_modifiers("Sign up for our 1 year membership")
        assert r.is_violation

    def test_step(self):
        r = check_grm06_compound_modifiers("Follow this 3 step guide")
        assert r.is_violation

    def test_mile(self):
        r = check_grm06_compound_modifiers("Begin the 5 mile hike")
        assert r.is_violation

    def test_in_sentence_context(self):
        r = check_grm06_compound_modifiers("We're offering a 7 day trial to new users")
        assert r.is_violation

    def test_plural_normalization(self):
        r = check_grm06_compound_modifiers("30 days trial")
        assert r.is_violation
        assert "30-day" in r.suggestion
        assert "30-days" not in r.suggestion


class TestGRM06NumericPasses:
    """Correctly hyphenated numeric compounds → PASS.

    Source: test_v450_patches.py
    """

    def test_day(self):
        r = check_grm06_compound_modifiers("5-day streak")
        assert r.is_pass

    def test_trial(self):
        r = check_grm06_compound_modifiers("Start your 30-day free trial")
        assert r.is_pass

    def test_hour(self):
        r = check_grm06_compound_modifiers("Join our 2-hour workshop")
        assert r.is_pass

    def test_week(self):
        r = check_grm06_compound_modifiers("Your 4-week plan is ready")
        assert r.is_pass

    def test_minute(self):
        r = check_grm06_compound_modifiers("Take the 5-minute quiz")
        assert r.is_pass


class TestGRM06NumericDefers:
    """Patterns that look like compounds but aren't → DEFER to LLM.

    Source: test_v450_patches.py
    """

    def test_standalone_duration_of(self):
        r = check_grm06_compound_modifiers("5 days of treatment")
        assert r.is_defer

    def test_standalone_duration_in(self):
        r = check_grm06_compound_modifiers("Arrive in 5 days")
        assert r.is_defer

    def test_relative_time_ago(self):
        r = check_grm06_compound_modifiers("Updated 3 days ago")
        assert r.is_defer

    def test_relative_time_later(self):
        r = check_grm06_compound_modifiers("Try again 5 minutes later")
        assert r.is_defer

    def test_remaining(self):
        r = check_grm06_compound_modifiers("5 days remaining")
        assert r.is_defer

    def test_left(self):
        r = check_grm06_compound_modifiers("3 steps left")
        assert r.is_defer

    def test_total(self):
        r = check_grm06_compound_modifiers("10 pages total")
        assert r.is_defer

    def test_each(self):
        r = check_grm06_compound_modifiers("5 dollars each")
        assert r.is_defer

    def test_per(self):
        r = check_grm06_compound_modifiers("3 miles per hour")
        assert r.is_defer

    def test_copula(self):
        r = check_grm06_compound_modifiers("5 days is plenty")
        assert r.is_defer

    def test_no_compound(self):
        r = check_grm06_compound_modifiers("Welcome to the app")
        assert r.is_defer

    def test_ordinal_deferred(self):
        r = check_grm06_compound_modifiers("a first time user")
        assert r.is_defer

    def test_ordinal_second(self):
        r = check_grm06_compound_modifiers("your second year review")
        assert r.is_defer


class TestGRM06SpelledOutViolations:
    """Spelled-out number compounds without hyphens → VIOLATION.

    Source: test_v450_patches.py
    """

    def test_one_time(self):
        r = check_grm06_compound_modifiers("It's a one time offer")
        assert r.is_violation
        assert "one-time" in r.suggestion

    def test_two_step(self):
        r = check_grm06_compound_modifiers("Follow our two step process")
        assert r.is_violation
        assert "two-step" in r.suggestion

    def test_two_factor(self):
        r = check_grm06_compound_modifiers("Enable two factor authentication")
        assert r.is_violation
        assert "two-factor" in r.suggestion

    def test_one_way(self):
        r = check_grm06_compound_modifiers("Book a one way trip")
        assert r.is_violation

    def test_five_minute(self):
        r = check_grm06_compound_modifiers("Take our five minute survey")
        assert r.is_violation

    def test_three_page(self):
        r = check_grm06_compound_modifiers("Submit a three page report")
        assert r.is_violation


class TestGRM06SpelledOutPasses:
    """Correctly hyphenated spelled-out compounds → PASS.

    Source: test_v450_patches.py
    """

    def test_one_time(self):
        r = check_grm06_compound_modifiers("It's a one-time offer")
        assert r.is_pass

    def test_two_step(self):
        r = check_grm06_compound_modifiers("two-step verification")
        assert r.is_pass

    def test_two_factor(self):
        r = check_grm06_compound_modifiers("Enable two-factor authentication")
        assert r.is_pass


class TestGRM06SpelledOutDefers:
    """Spelled-out patterns that aren't compound modifiers → DEFER.

    Source: test_v450_patches.py
    """

    def test_one_day_in(self):
        r = check_grm06_compound_modifiers("one day in the park")
        assert r.is_defer

    def test_five_ways_to(self):
        r = check_grm06_compound_modifiers("five ways to improve")
        assert r.is_defer

    def test_two_factors_are(self):
        r = check_grm06_compound_modifiers("two factors are important")
        assert r.is_defer


class TestGRM06Integration:
    """GRM-06 registered in the preprocess() pipeline.

    Source: test_v450_patches.py
    """

    def test_registered(self):
        results = preprocess("5 day streak", "short_ui_copy")
        grm06 = [r for r in results if r.standard_id == "GRM-06"]
        assert len(grm06) == 1
        assert grm06[0].is_violation

    def test_pass_registered(self):
        results = preprocess("5-day streak", "short_ui_copy")
        grm06 = [r for r in results if r.standard_id == "GRM-06"]
        assert len(grm06) == 1
        assert grm06[0].is_pass

    def test_total_check_count(self):
        """Verify the preprocessor runs 25 checks."""
        results = preprocess("Hello world", "short_ui_copy")
        assert len(results) >= 24  # >= because CLR-01 has two sub-checks


class TestGRM06EdgeCases:
    """Boundary conditions and adversarial inputs.

    Source: test_v450_patches.py
    """

    def test_double_s_protection(self):
        r = check_grm06_compound_modifiers("5 day streak")
        assert "day" in r.suggestion

    def test_case_insensitive(self):
        r = check_grm06_compound_modifiers("Join our 2 Hour Workshop")
        assert r.is_violation

    def test_multidigit(self):
        r = check_grm06_compound_modifiers("Complete the 365 day challenge")
        assert r.is_violation
        assert "365-day" in r.suggestion

    def test_pass_takes_priority_over_violation(self):
        r = check_grm06_compound_modifiers("Use the 5-day plan, not the 7 day option")
        assert r.is_pass


# ═══════════════════════════════════════════════════════════════════════
# Convention checks
# ═══════════════════════════════════════════════════════════════════════


# --- CON-02: Sentence case safe phrases ---


class TestCON02SafePhrases:
    """Industry-standard two-word patterns that should PASS, not defer.

    Source: test_v450_patches.py
    """

    @pytest.mark.parametrize("phrase", [
        "See All", "View All", "Show All", "Browse All",
        "Show More", "Load More", "View More",
        "Sign In", "Sign Up", "Sign Out", "Log In", "Log Out",
        "Add New", "Create New",
        "Go Back", "Go Home",
        "Opt In", "Opt Out",
        "Get Started", "Try Free",
    ])
    def test_safe_phrase_passes(self, phrase):
        """Each safe phrase gets CON-02 PASS — they're not title case violations."""
        r = check_con02_sentence_case(phrase)
        assert r.is_pass, f"'{phrase}' should PASS CON-02 as a safe phrase"

    @pytest.mark.parametrize("phrase", [
        "see all", "view all", "sign in", "log out",
    ])
    def test_safe_phrase_lowercase_passes(self, phrase):
        """Lowercase versions also pass (already sentence case)."""
        r = check_con02_sentence_case(phrase)
        assert r.is_pass

    def test_real_title_case_still_defers(self):
        """Actual title case is NOT in the safe list → still defers."""
        r = check_con02_sentence_case("Manage Your Preferences")
        assert r.is_defer

    def test_safe_phrase_not_in_longer_text(self):
        """Safe phrases only match the full input, not substrings."""
        r = check_con02_sentence_case("See All Products")
        assert r.is_defer

    def test_allowlist_frozen(self):
        """The allowlist is a frozenset for O(1) lookup."""
        assert isinstance(CON02_SAFE_PHRASES, frozenset)

    def test_existing_sentence_case_still_passes(self):
        """Regression: normal sentence case text still passes."""
        r = check_con02_sentence_case("Manage your preferences")
        assert r.is_pass

    def test_single_word_still_defers(self):
        """Regression: single words still defer (ambiguous)."""
        r = check_con02_sentence_case("Settings")
        assert r.is_defer


# --- CON-03: Date formats ---


class TestCON03DateFormats:
    """Numeric-only dates are violations. Spelled-out months pass.

    Source: test_preprocess.py
    """

    def test_numeric_slash_date_violation(self):
        r = check_con03_date_formats("Last updated 3/16/26.")
        assert r.outcome == Outcome.VIOLATION

    def test_numeric_dash_date_violation(self):
        r = check_con03_date_formats("Effective 03-16-2026.")
        assert r.outcome == Outcome.VIOLATION

    def test_spelled_out_month_defers(self):
        """Spelled-out months are fine — defer to LLM for any other issues."""
        r = check_con03_date_formats("Last updated March 16, 2026.")
        assert r.outcome == Outcome.DEFER

    def test_no_date_defers(self):
        r = check_con03_date_formats("Your order shipped.")
        assert r.outcome == Outcome.DEFER

    def test_version_number_defers(self):
        """Don't flag version numbers that look like dates."""
        r = check_con03_date_formats("Version 2.0.1 released.")
        assert r.outcome == Outcome.DEFER


# ═══════════════════════════════════════════════════════════════════════
# Proofing checks
# ═══════════════════════════════════════════════════════════════════════


# --- PRF-01: Double spaces ---


class TestPRF01DoubleSpaces:
    """Source: test_preprocess.py"""

    def test_double_space_violation(self):
        r = check_prf01_double_spaces("Click here  to continue.")
        assert r.outcome == Outcome.VIOLATION

    def test_triple_space_violation(self):
        r = check_prf01_double_spaces("Save   your changes.")
        assert r.outcome == Outcome.VIOLATION

    def test_single_space_pass(self):
        r = check_prf01_double_spaces("Click here to continue.")
        assert r.outcome == Outcome.PASS

    def test_empty_string_pass(self):
        r = check_prf01_double_spaces("")
        assert r.outcome == Outcome.PASS


class TestPrf01DataDisplayException:
    """Padded pipe separators in data visualizations should not trigger PRF-01.

    Source: test_triage_fixes.py
    """

    # --- Passes (data display patterns) ---

    def test_percentage_pipe_number(self):
        """Canonical case from Opendoor triage: '63.6%  |  4.7M'."""
        r = check_prf01_double_spaces("63.6%  |  4.7M")
        assert r.is_pass
        assert r.standard_id == "PRF-01"

    def test_dollar_pipe_percentage(self):
        r = check_prf01_double_spaces("$1.2M  |  45.3%")
        assert r.is_pass

    def test_number_pipe_number(self):
        r = check_prf01_double_spaces("100  |  200")
        assert r.is_pass

    def test_kilo_suffix_pipe(self):
        r = check_prf01_double_spaces("4.7K  |  2.1M")
        assert r.is_pass

    def test_billion_suffix_pipe(self):
        r = check_prf01_double_spaces("1.5B  |  3.2B")
        assert r.is_pass

    def test_multi_segment_data(self):
        """Multiple pipe-separated data segments in one string."""
        r = check_prf01_double_spaces("63.6%  |  4.7M  |  $12.5K")
        assert r.is_pass

    def test_single_pipe_padding(self):
        r = check_prf01_double_spaces("99.9%  |  100")
        assert r.is_pass

    # --- Violations (genuine double spaces) ---

    def test_genuine_double_space_still_caught(self):
        r = check_prf01_double_spaces("Click here  to continue")
        assert r.is_violation
        assert r.standard_id == "PRF-01"

    def test_double_space_with_no_pipe(self):
        r = check_prf01_double_spaces("Save  your changes")
        assert r.is_violation

    def test_mixed_data_and_regular_double_space(self):
        """Data display pipe is fine, but genuine double space elsewhere is flagged."""
        r = check_prf01_double_spaces("Sales: 63.6%  |  4.7M   total revenue")
        assert r.is_violation

    # --- Defers (no double spaces at all) ---

    def test_single_spaces_clean(self):
        r = check_prf01_double_spaces("Everything looks great")
        assert r.is_pass

    def test_single_pipe_no_padding(self):
        r = check_prf01_double_spaces("100 | 200")
        assert r.is_pass

    # --- Regex unit tests ---

    def test_regex_matches_percentage_pipe(self):
        assert _DATA_DISPLAY_PIPE.search("63.6%  |  4.7M") is not None

    def test_regex_matches_dollar_pipe(self):
        assert _DATA_DISPLAY_PIPE.search("$1.2M  |  45.3%") is not None

    def test_regex_no_match_text_pipe(self):
        """Text around pipes should not match the data display pattern."""
        assert _DATA_DISPLAY_PIPE.search("hello  |  world") is None

    def test_regex_no_match_single_space(self):
        """Single-space padding around pipe does not match."""
        assert _DATA_DISPLAY_PIPE.search("100 | 200") is None


# --- PRF-02: Repeated words ---


class TestPRF02RepeatedWords:
    """Source: test_preprocess.py"""

    def test_the_the_violation(self):
        r = check_prf02_repeated_words("Click the the button.")
        assert r.outcome == Outcome.VIOLATION

    def test_and_and_violation(self):
        r = check_prf02_repeated_words("Save and and continue.")
        assert r.outcome == Outcome.VIOLATION

    def test_case_insensitive(self):
        r = check_prf02_repeated_words("The the button is here.")
        assert r.outcome == Outcome.VIOLATION

    def test_no_repeat_pass(self):
        r = check_prf02_repeated_words("Click the button.")
        assert r.outcome == Outcome.PASS

    def test_same_word_not_adjacent_pass(self):
        r = check_prf02_repeated_words("The button and the link.")
        assert r.outcome == Outcome.PASS


# --- PRF-03: Trailing period on headings ---


class TestPRF03TrailingPeriod:
    """Source: test_preprocess.py"""

    def test_heading_with_period_violation(self):
        r = check_prf03_trailing_period_on_headings("Your account settings.", "heading")
        assert r.outcome == Outcome.VIOLATION

    def test_button_with_period_violation(self):
        r = check_prf03_trailing_period_on_headings("Save changes.", "button_cta")
        assert r.outcome == Outcome.VIOLATION

    def test_label_with_period_violation(self):
        r = check_prf03_trailing_period_on_headings("Email address.", "ui_label")
        assert r.outcome == Outcome.VIOLATION

    def test_heading_without_period_pass(self):
        r = check_prf03_trailing_period_on_headings("Your account settings", "heading")
        assert r.outcome == Outcome.PASS

    def test_heading_with_question_mark_pass(self):
        r = check_prf03_trailing_period_on_headings("Ready to get started?", "heading")
        assert r.outcome == Outcome.PASS

    def test_heading_with_ellipsis_pass(self):
        """Ellipsis is not a period — loading states use this legitimately."""
        r = check_prf03_trailing_period_on_headings("Loading...", "heading")
        assert r.outcome == Outcome.PASS

    def test_body_copy_defers(self):
        """Periods in body copy are normal — don't check."""
        r = check_prf03_trailing_period_on_headings("Your order shipped.", "short_ui_copy")
        assert r.outcome == Outcome.DEFER


# --- PRF-04: Straight quotes ---


class TestPRF04StraightQuotes:
    """Source: test_preprocess.py"""

    def test_straight_double_quote_violation(self):
        r = check_prf04_straight_quotes('Click "Submit" to continue.', "short_ui_copy")
        assert r.outcome == Outcome.VIOLATION

    def test_curly_double_quotes_pass(self):
        r = check_prf04_straight_quotes("Click \u201cSubmit\u201d to continue.", "short_ui_copy")
        assert r.outcome == Outcome.PASS

    def test_contraction_apostrophe_pass(self):
        """Contractions with straight apostrophes are too common to flag."""
        r = check_prf04_straight_quotes("You can't undo this action.", "short_ui_copy")
        assert r.outcome == Outcome.PASS

    def test_possessive_apostrophe_pass(self):
        r = check_prf04_straight_quotes("Your team's settings.", "short_ui_copy")
        assert r.outcome == Outcome.PASS

    def test_no_quotes_pass(self):
        r = check_prf04_straight_quotes("Click the button to continue.", "short_ui_copy")
        assert r.outcome == Outcome.PASS


class TestPrf04InchMarks:
    """Straight double quotes after digits are inch marks, not typography errors.

    Source: test_apple_patches.py
    """

    # --- Passes (measurements) ---

    def test_13_inch_passes(self):
        r = check_prf04_straight_quotes('The 13" MacBook Air', "short_ui_copy")
        assert r.is_pass

    def test_15_inch_passes(self):
        r = check_prf04_straight_quotes('15" MacBook Pro', "ui_label")
        assert r.is_pass

    def test_27_inch_display(self):
        r = check_prf04_straight_quotes('27" Retina display', "heading")
        assert r.is_pass

    def test_multiple_measurements(self):
        r = check_prf04_straight_quotes(
            'Available in 13" and 15" sizes', "short_ui_copy",
        )
        assert r.is_pass

    def test_decimal_measurement(self):
        r = check_prf04_straight_quotes('15.6" laptop screen', "short_ui_copy")
        assert r.is_pass

    def test_mixed_measurement_and_contraction(self):
        """Inch mark + contraction = still pass (both are safe)."""
        r = check_prf04_straight_quotes(
            "It's a 13\" display", "short_ui_copy",
        )
        assert r.is_pass

    # --- Violations (real straight quotes) ---

    def test_quoted_word_still_flags(self):
        r = check_prf04_straight_quotes('He said "hello"', "short_ui_copy")
        assert r.is_violation

    def test_scare_quotes_still_flag(self):
        r = check_prf04_straight_quotes(
            'The "free" trial requires a credit card', "short_ui_copy",
        )
        assert r.is_violation

    def test_non_digit_double_quote_flags(self):
        """Quote NOT preceded by a digit is not a measurement."""
        r = check_prf04_straight_quotes('Click "Submit" to continue', "short_ui_copy")
        assert r.is_violation

    # --- Edge cases ---

    def test_developer_content_defers(self):
        r = check_prf04_straight_quotes('Use "strict" mode', "tooltip_microcopy")
        assert r.is_defer

    def test_no_quotes_passes(self):
        r = check_prf04_straight_quotes("Clean text with no quotes", "short_ui_copy")
        assert r.is_pass

    def test_curly_quotes_pass(self):
        r = check_prf04_straight_quotes(
            "The \u201cbest\u201d option available", "short_ui_copy",
        )
        assert r.is_pass


# --- PRF-05: Missing space after punctuation ---


class TestPRF05MissingSpaceAfterPunctuation:
    """Source: test_preprocess.py"""

    def test_missing_space_after_period_violation(self):
        r = check_prf05_missing_space_after_punctuation("Click here.Then sign in.")
        assert r.outcome == Outcome.VIOLATION

    def test_missing_space_after_exclamation_violation(self):
        r = check_prf05_missing_space_after_punctuation("Welcome!Click here.")
        assert r.outcome == Outcome.VIOLATION

    def test_missing_space_after_question_violation(self):
        r = check_prf05_missing_space_after_punctuation("Ready?Click here.")
        assert r.outcome == Outcome.VIOLATION

    def test_normal_spacing_pass(self):
        r = check_prf05_missing_space_after_punctuation("Click here. Then sign in.")
        assert r.outcome == Outcome.PASS

    def test_url_not_flagged(self):
        r = check_prf05_missing_space_after_punctuation("Visit https://example.com for details.")
        assert r.outcome == Outcome.PASS

    def test_decimal_not_flagged(self):
        r = check_prf05_missing_space_after_punctuation("The price is 2.99 per month.")
        assert r.outcome == Outcome.PASS

    def test_abbreviation_not_flagged(self):
        r = check_prf05_missing_space_after_punctuation("Open 8 a.m. to 5 p.m. daily.")
        assert r.outcome == Outcome.PASS

    def test_ellipsis_not_flagged(self):
        r = check_prf05_missing_space_after_punctuation("Loading...please wait.")
        assert r.outcome == Outcome.PASS


# --- PRF-06: Leading/trailing whitespace ---


class TestPRF06LeadingTrailingWhitespace:
    """Source: test_preprocess.py"""

    def test_leading_space_violation(self):
        r = check_prf06_leading_trailing_whitespace(" Click here")
        assert r.outcome == Outcome.VIOLATION

    def test_trailing_space_violation(self):
        r = check_prf06_leading_trailing_whitespace("Click here ")
        assert r.outcome == Outcome.VIOLATION

    def test_leading_tab_violation(self):
        r = check_prf06_leading_trailing_whitespace("\tClick here")
        assert r.outcome == Outcome.VIOLATION

    def test_trailing_newline_violation(self):
        r = check_prf06_leading_trailing_whitespace("Click here\n")
        assert r.outcome == Outcome.VIOLATION

    def test_clean_string_pass(self):
        r = check_prf06_leading_trailing_whitespace("Click here")
        assert r.outcome == Outcome.PASS

    def test_internal_whitespace_pass(self):
        """Spaces inside the string are fine."""
        r = check_prf06_leading_trailing_whitespace("Click here to continue")
        assert r.outcome == Outcome.PASS


# --- PRF-07: Space before punctuation ---


class TestPRF07SpaceBeforePunctuation:
    """Source: test_preprocess.py"""

    def test_space_before_period_violation(self):
        r = check_prf07_space_before_punctuation("Click here .")
        assert r.outcome == Outcome.VIOLATION

    def test_space_before_comma_violation(self):
        r = check_prf07_space_before_punctuation("Save , then continue.")
        assert r.outcome == Outcome.VIOLATION

    def test_space_before_exclamation_violation(self):
        r = check_prf07_space_before_punctuation("Welcome !")
        assert r.outcome == Outcome.VIOLATION

    def test_space_before_question_violation(self):
        r = check_prf07_space_before_punctuation("Ready ?")
        assert r.outcome == Outcome.VIOLATION

    def test_space_before_colon_violation(self):
        r = check_prf07_space_before_punctuation("Step 1 : Create account")
        assert r.outcome == Outcome.VIOLATION

    def test_no_space_before_punctuation_pass(self):
        r = check_prf07_space_before_punctuation("Click here. Then continue.")
        assert r.outcome == Outcome.PASS

    def test_ellipsis_with_space_pass(self):
        """Some styles allow space before ellipsis."""
        r = check_prf07_space_before_punctuation("Loading ...")
        assert r.outcome == Outcome.PASS


# --- PRF-08: Placeholder text ---


class TestPrf08PlaceholderText:
    """Flag placeholder, dummy, and dev marker text.

    Source: test_preprocess_phase2.py
    """

    # --- Violations ---

    def test_lorem_ipsum(self):
        r = check_prf08_placeholder_text("Lorem ipsum dolor sit amet")
        assert r.is_violation
        assert r.standard_id == "PRF-08"

    def test_lorem_ipsum_case_insensitive(self):
        r = check_prf08_placeholder_text("LOREM IPSUM dolor sit amet")
        assert r.is_violation

    def test_lorem_ipsum_mid_sentence(self):
        r = check_prf08_placeholder_text("Replace this: Lorem ipsum dolor sit amet.")
        assert r.is_violation

    def test_tbd_marker(self):
        r = check_prf08_placeholder_text("TBD")
        assert r.is_violation

    def test_todo_marker(self):
        r = check_prf08_placeholder_text("TODO: Write real copy")
        assert r.is_violation

    def test_fixme_marker(self):
        r = check_prf08_placeholder_text("FIXME — this needs a rewrite")
        assert r.is_violation

    def test_placeholder_marker(self):
        r = check_prf08_placeholder_text("PLACEHOLDER text here")
        assert r.is_violation

    def test_wip_marker(self):
        r = check_prf08_placeholder_text("WIP: Onboarding flow")
        assert r.is_violation

    def test_draft_marker(self):
        r = check_prf08_placeholder_text("DRAFT copy for review")
        assert r.is_violation

    def test_bracket_placeholder_insert(self):
        r = check_prf08_placeholder_text("Welcome to [insert company name]")
        assert r.is_violation

    def test_bracket_placeholder_your(self):
        r = check_prf08_placeholder_text("Hello [your name here]")
        assert r.is_violation

    def test_bracket_placeholder_replace(self):
        r = check_prf08_placeholder_text("[Replace with final heading]")
        assert r.is_violation

    def test_bracket_placeholder_tbd(self):
        r = check_prf08_placeholder_text("Price: [TBD]")
        assert r.is_violation

    # --- Passes ---

    def test_clean_copy(self):
        r = check_prf08_placeholder_text("Save your changes")
        assert r.is_pass

    def test_normal_brackets(self):
        r = check_prf08_placeholder_text("Enter your email [required]")
        assert r.is_pass

    def test_todo_lowercase_in_prose(self):
        """Lowercase 'todo' in normal prose should not flag."""
        r = check_prf08_placeholder_text("Add a new todo item to your list")
        assert r.is_pass

    def test_draft_lowercase_in_prose(self):
        """Lowercase 'draft' in normal prose should not flag."""
        r = check_prf08_placeholder_text("Save as draft")
        assert r.is_pass


# --- PRF-09: All caps ---


class TestPrf09AllCaps:
    """Flag ALL CAPS words (4+ letters) that aren't known acronyms.

    Source: test_preprocess_phase2.py
    """

    # --- Violations ---

    def test_all_caps_word(self):
        r = check_prf09_all_caps("Your SUBSCRIPTION has expired")
        assert r.is_violation
        assert r.standard_id == "PRF-09"

    def test_all_caps_action(self):
        r = check_prf09_all_caps("CLICK HERE TO CONTINUE")
        assert r.is_violation

    def test_all_caps_warning(self):
        r = check_prf09_all_caps("WARNING: This action cannot be undone")
        assert r.is_violation

    def test_all_caps_multiple(self):
        r = check_prf09_all_caps("YOUR ACCOUNT IS SUSPENDED")
        assert r.is_violation

    # --- Passes ---

    def test_known_acronym_hipaa(self):
        r = check_prf09_all_caps("Check your HIPAA compliance")
        assert r.is_pass

    def test_known_acronym_api(self):
        """Short acronyms (<4 chars) never flag."""
        r = check_prf09_all_caps("Your API key is ready")
        assert r.is_pass

    def test_known_acronym_https(self):
        r = check_prf09_all_caps("Requires HTTPS connection")
        assert r.is_pass

    def test_common_ui_pattern_free(self):
        r = check_prf09_all_caps("Try FREE for 30 days")
        assert r.is_pass

    def test_common_ui_pattern_sale(self):
        r = check_prf09_all_caps("SALE ends Friday")
        assert r.is_pass

    def test_common_ui_pattern_beta(self):
        r = check_prf09_all_caps("BETA feature available")
        assert r.is_pass

    def test_no_caps_words(self):
        r = check_prf09_all_caps("Your account is ready")
        assert r.is_pass

    def test_short_caps_ok(self):
        """Three-letter caps like 'THE' shouldn't flag."""
        r = check_prf09_all_caps("THE end")
        assert r.is_pass

    def test_dev_markers_excluded(self):
        """Dev markers are caught by PRF-08, not PRF-09."""
        r = check_prf09_all_caps("TODO: Fix this")
        assert r.is_pass


# --- PRF-10: Latin abbreviations ---


class TestPrf10LatinAbbreviations:
    """Flag e.g., i.e., etc. for accessibility and localization.

    Source: test_preprocess_phase3.py
    """

    # --- Violations ---

    def test_eg(self):
        r = check_prf10_latin_abbreviations("Use e.g. commas for lists", "short_ui_copy")
        assert r.is_violation
        assert r.standard_id == "PRF-10"
        assert "for example" in r.suggestion

    def test_ie(self):
        r = check_prf10_latin_abbreviations("The result, i.e. the output", "short_ui_copy")
        assert r.is_violation
        assert "that is" in r.suggestion

    def test_etc(self):
        r = check_prf10_latin_abbreviations("Add files, images, etc.", "short_ui_copy")
        assert r.is_violation
        assert "and so on" in r.suggestion

    def test_eg_in_error_message(self):
        r = check_prf10_latin_abbreviations("Enter a valid format, e.g. MM/DD", "error_message")
        assert r.is_violation

    def test_case_insensitive(self):
        r = check_prf10_latin_abbreviations("E.g. this example", "short_ui_copy")
        assert r.is_violation

    def test_etc_in_long_form(self):
        r = check_prf10_latin_abbreviations("Supports PDF, DOCX, etc.", "long_form_copy")
        assert r.is_violation

    # --- Defers ---

    def test_tooltip_defers(self):
        """Developer-facing content types should defer."""
        r = check_prf10_latin_abbreviations("e.g. 'hello world'", "tooltip_microcopy")
        assert r.is_defer

    # --- Passes ---

    def test_clean_copy(self):
        r = check_prf10_latin_abbreviations("For example, try this approach", "short_ui_copy")
        assert r.is_pass

    def test_no_latin(self):
        r = check_prf10_latin_abbreviations("Upload your files here", "short_ui_copy")
        assert r.is_pass

    def test_siege_no_false_positive(self):
        """'siege' should not trigger 'i.e.' matching."""
        r = check_prf10_latin_abbreviations("Under siege from requests", "short_ui_copy")
        assert r.is_pass


# --- PRF-11: Dismissive language ---


class TestPrf11DismissiveLanguage:
    """Flag simply, easily, just + verb in instructional content.

    Source: test_preprocess_phase3.py
    """

    # --- Violations ---

    def test_simply(self):
        r = check_prf11_dismissive_language("Simply click save", "short_ui_copy")
        assert r.is_violation
        assert r.standard_id == "PRF-11"

    def test_easily(self):
        r = check_prf11_dismissive_language("You can easily update it", "short_ui_copy")
        assert r.is_violation

    def test_just_click(self):
        r = check_prf11_dismissive_language("Just click the button", "short_ui_copy")
        assert r.is_violation

    def test_just_select(self):
        r = check_prf11_dismissive_language("Just select your plan", "error_message")
        assert r.is_violation

    def test_just_enter(self):
        r = check_prf11_dismissive_language("Just enter your email", "tooltip_microcopy")
        assert r.is_violation

    def test_easy_setup(self):
        r = check_prf11_dismissive_language("Easy setup in minutes", "short_ui_copy")
        assert r.is_violation

    def test_simple_to(self):
        r = check_prf11_dismissive_language("Simple to configure", "long_form_copy")
        assert r.is_violation

    def test_easy_steps(self):
        r = check_prf11_dismissive_language("Follow these easy steps", "short_ui_copy")
        assert r.is_violation

    def test_in_error_message(self):
        r = check_prf11_dismissive_language("Simply re-enter your password", "error_message")
        assert r.is_violation

    def test_in_confirmation(self):
        r = check_prf11_dismissive_language("You can easily undo this", "confirmation")
        assert r.is_violation

    # --- Defers ---

    def test_heading_defers(self):
        """Marketing headings should defer — 'easy' is a value prop there."""
        r = check_prf11_dismissive_language("Simply the best", "heading")
        assert r.is_defer

    def test_button_defers(self):
        r = check_prf11_dismissive_language("Easy setup", "button_cta")
        assert r.is_defer

    def test_ui_label_defers(self):
        r = check_prf11_dismissive_language("Simple mode", "ui_label")
        assert r.is_defer

    def test_clean_copy(self):
        r = check_prf11_dismissive_language("Click save to continue", "short_ui_copy")
        assert r.is_defer

    def test_just_without_verb(self):
        """'just' without a triggering verb should defer."""
        r = check_prf11_dismissive_language("Just a moment", "short_ui_copy")
        assert r.is_defer

    def test_simple_without_modifier(self):
        """'simple' alone without a following task word should defer."""
        r = check_prf11_dismissive_language("A simple design", "short_ui_copy")
        assert r.is_defer


class TestPrf11Effortlessly:
    """Adding 'effortlessly' to the dismissive language pattern.

    Source: test_apple_patches.py
    """

    def test_effortlessly_violation_short_ui(self):
        r = check_prf11_dismissive_language(
            "Manage your finances effortlessly.", "short_ui_copy",
        )
        assert r.is_violation
        assert r.standard_id == "PRF-11"

    def test_effortlessly_violation_error_message(self):
        r = check_prf11_dismissive_language(
            "Effortlessly recover your data", "error_message",
        )
        assert r.is_violation

    def test_effortlessly_violation_long_form(self):
        r = check_prf11_dismissive_language(
            "You can effortlessly switch between apps.", "long_form_copy",
        )
        assert r.is_violation

    def test_effortlessly_defers_on_heading(self):
        """Marketing headings get a pass — 'effortlessly' is a value prop."""
        r = check_prf11_dismissive_language(
            "Edit photos effortlessly", "heading",
        )
        assert r.is_defer

    def test_effortlessly_defers_on_button(self):
        r = check_prf11_dismissive_language(
            "Effortlessly organize", "button_cta",
        )
        assert r.is_defer

    def test_simply_still_fires(self):
        """Regression: existing pattern not broken by the addition."""
        r = check_prf11_dismissive_language("Simply click save", "short_ui_copy")
        assert r.is_violation

    def test_easily_still_fires(self):
        """Regression: existing pattern not broken by the addition."""
        r = check_prf11_dismissive_language("You can easily update it", "short_ui_copy")
        assert r.is_violation

    def test_effort_not_matched(self):
        """'effort' alone is NOT dismissive — only 'effortlessly'."""
        r = check_prf11_dismissive_language(
            "This requires effort to set up.", "short_ui_copy",
        )
        assert r.is_defer


# ═══════════════════════════════════════════════════════════════════════
# Clarity checks
# ═══════════════════════════════════════════════════════════════════════


# --- CLR-01: Redundant phrases + banned words ---


class TestClr01RedundantPhrases:
    """Flag wordy phrases with universally simpler replacements.

    Source: test_preprocess_phase2.py
    """

    # --- Violations ---

    def test_in_order_to(self):
        r = check_clr01_redundant_phrases("Click the button in order to save")
        assert r.is_violation
        assert r.standard_id == "CLR-01"
        assert "to" in r.suggestion

    def test_whether_or_not(self):
        r = check_clr01_redundant_phrases("Choose whether or not to continue")
        assert r.is_violation

    def test_due_to_the_fact_that(self):
        r = check_clr01_redundant_phrases("Failed due to the fact that the server is down")
        assert r.is_violation

    def test_at_this_point_in_time(self):
        r = check_clr01_redundant_phrases("At this point in time, your account is active")
        assert r.is_violation

    def test_has_the_ability_to(self):
        r = check_clr01_redundant_phrases("This feature has the ability to export data")
        assert r.is_violation

    def test_is_able_to(self):
        r = check_clr01_redundant_phrases("You are able to change your password")
        assert r.is_violation

    def test_in_the_event_that(self):
        r = check_clr01_redundant_phrases("In the event that your payment fails, try again")
        assert r.is_violation

    def test_prior_to(self):
        r = check_clr01_redundant_phrases("Complete this step prior to submitting")
        assert r.is_violation

    def test_case_insensitive(self):
        r = check_clr01_redundant_phrases("In Order To save your work, click below")
        assert r.is_violation

    # --- Defers ---

    def test_clean_copy_defers(self):
        r = check_clr01_redundant_phrases("Click to save your changes")
        assert r.is_defer

    def test_partial_match_no_flag(self):
        """'to' alone should not trigger 'in order to'."""
        r = check_clr01_redundant_phrases("Go to settings to update your preferences")
        assert r.is_defer


class TestClr01BannedWords:
    """Flag unnecessarily complex words with simpler alternatives.

    Source: test_preprocess_phase2.py
    """

    # --- Violations ---

    def test_utilize(self):
        r = check_clr01_banned_words("Utilize the dashboard to track progress")
        assert r.is_violation
        assert "use" in r.suggestion

    def test_leverage(self):
        r = check_clr01_banned_words("Leverage our tools to grow your business")
        assert r.is_violation

    def test_facilitate(self):
        r = check_clr01_banned_words("We facilitate secure payments")
        assert r.is_violation

    def test_commence(self):
        r = check_clr01_banned_words("Commence the onboarding process")
        assert r.is_violation

    def test_terminate(self):
        r = check_clr01_banned_words("Terminate your subscription anytime")
        assert r.is_violation

    def test_aforementioned(self):
        r = check_clr01_banned_words("The aforementioned settings are required")
        assert r.is_violation

    def test_case_insensitive(self):
        r = check_clr01_banned_words("UTILIZE the dashboard")
        assert r.is_violation

    # --- Defers ---

    def test_clean_copy(self):
        r = check_clr01_banned_words("Use the dashboard to track progress")
        assert r.is_defer

    def test_partial_word_no_flag(self):
        """'terminal' should not trigger 'terminate'."""
        r = check_clr01_banned_words("Open the terminal app")
        assert r.is_defer


# ═══════════════════════════════════════════════════════════════════════
# Accessibility checks
# ═══════════════════════════════════════════════════════════════════════


# --- ACC-01: Vague link text ---


class TestAcc01VagueLinkText:
    """Flag 'click here' and similar non-descriptive link text.

    Source: test_preprocess_phase2.py
    """

    # --- Violations ---

    def test_click_here(self):
        r = check_acc01_vague_link_text("Click here to see pricing")
        assert r.is_violation
        assert r.standard_id == "ACC-01"

    def test_read_more(self):
        r = check_acc01_vague_link_text("Read more about our features")
        assert r.is_violation

    def test_learn_more(self):
        r = check_acc01_vague_link_text("Learn more")
        assert r.is_violation

    def test_more_info(self):
        r = check_acc01_vague_link_text("More info about your account")
        assert r.is_violation

    def test_tap_here(self):
        r = check_acc01_vague_link_text("Tap here to continue")
        assert r.is_violation

    def test_case_insensitive(self):
        r = check_acc01_vague_link_text("CLICK HERE for details")
        assert r.is_violation

    # --- Defers ---

    def test_descriptive_link(self):
        r = check_acc01_vague_link_text("View our pricing plans")
        assert r.is_defer

    def test_action_verb_link(self):
        r = check_acc01_vague_link_text("Download the report")
        assert r.is_defer

    def test_click_in_instruction(self):
        """'click' alone (without 'here') should defer to LLM."""
        r = check_acc01_vague_link_text("Click the save button")
        assert r.is_defer


class TestAcc01Expanded:
    """Verify expanded ACC-01 catches standalone and leading phrases.

    Source: test_preprocess_phase3.py
    """

    def test_standalone_read_more(self):
        r = check_acc01_vague_link_text("Read more")
        assert r.is_violation
        assert r.standard_id == "ACC-01"

    def test_standalone_learn_more(self):
        r = check_acc01_vague_link_text("Learn more")
        assert r.is_violation

    def test_standalone_more_info(self):
        r = check_acc01_vague_link_text("More info")
        assert r.is_violation

    def test_leading_learn_more(self):
        r = check_acc01_vague_link_text("Learn more about billing")
        assert r.is_violation

    def test_embedded_click_here(self):
        r = check_acc01_vague_link_text("Click here to see pricing")
        assert r.is_violation

    def test_descriptive_link_defers(self):
        r = check_acc01_vague_link_text("View our pricing plans")
        assert r.is_defer


# ═══════════════════════════════════════════════════════════════════════
# Inclusion checks
# ═══════════════════════════════════════════════════════════════════════


# --- INC-01: Gendered language ---


class TestInc01GenderedLanguage:
    """Flag gendered terms with gender-neutral alternatives.

    Source: test_preprocess_phase2.py
    """

    # --- Violations ---

    def test_chairman(self):
        r = check_inc01_gendered_language("Contact the chairman")
        assert r.is_violation
        assert r.standard_id == "INC-01"

    def test_mankind(self):
        r = check_inc01_gendered_language("The greatest achievement of mankind")
        assert r.is_violation

    def test_manpower(self):
        r = check_inc01_gendered_language("We need more manpower on this project")
        assert r.is_violation

    def test_fireman(self):
        r = check_inc01_gendered_language("Call the fireman")
        assert r.is_violation

    def test_he_she(self):
        r = check_inc01_gendered_language("The user can update he/she profile")
        assert r.is_violation

    def test_his_or_her(self):
        r = check_inc01_gendered_language("Each user must verify his or her email")
        assert r.is_violation

    def test_salesman(self):
        r = check_inc01_gendered_language("Ask your salesman for details")
        assert r.is_violation

    def test_case_insensitive(self):
        r = check_inc01_gendered_language("The CHAIRMAN will decide")
        assert r.is_violation

    # --- Defers ---

    def test_clean_copy(self):
        r = check_inc01_gendered_language("Contact the chair for details")
        assert r.is_defer

    def test_gender_neutral_they(self):
        r = check_inc01_gendered_language("The user can update their profile")
        assert r.is_defer

    def test_person_word_no_flag(self):
        """'manage' should not trigger 'man'-based matching."""
        r = check_inc01_gendered_language("Manage your account settings")
        assert r.is_defer


# --- INC-02: Non-inclusive tech terminology ---


class TestInc02NonInclusiveTech:
    """Flag non-inclusive tech terms with industry-standard alternatives.

    Source: test_preprocess_phase2.py
    """

    # --- Violations ---

    def test_whitelist(self):
        r = check_inc02_non_inclusive_tech("Add the IP to the whitelist")
        assert r.is_violation
        assert r.standard_id == "INC-02"

    def test_blacklist(self):
        r = check_inc02_non_inclusive_tech("The domain is on our blacklist")
        assert r.is_violation

    def test_master(self):
        r = check_inc02_non_inclusive_tech("Push to the master branch")
        assert r.is_violation

    def test_slave(self):
        r = check_inc02_non_inclusive_tech("Configure the slave database")
        assert r.is_violation

    def test_grandfathered(self):
        r = check_inc02_non_inclusive_tech("Your plan is grandfathered in")
        assert r.is_violation

    def test_case_insensitive(self):
        r = check_inc02_non_inclusive_tech("Add to WHITELIST")
        assert r.is_violation

    # --- Defers ---

    def test_clean_copy(self):
        r = check_inc02_non_inclusive_tech("Add the IP to the allow list")
        assert r.is_defer

    def test_partial_word_no_flag(self):
        """'mastery' should not trigger 'master'."""
        r = check_inc02_non_inclusive_tech("Achieve mastery of the platform")
        assert r.is_defer


class TestInc02ContextGating:
    """Verify 'master' is only flagged in tech contexts.

    Source: test_preprocess_phase3.py
    """

    # --- Violations (tech context) ---

    def test_master_branch(self):
        r = check_inc02_non_inclusive_tech("Push to master branch")
        assert r.is_violation
        assert r.standard_id == "INC-02"

    def test_master_node(self):
        r = check_inc02_non_inclusive_tech("Configure the master node")
        assert r.is_violation

    def test_master_server(self):
        r = check_inc02_non_inclusive_tech("The master server is down")
        assert r.is_violation

    def test_master_database(self):
        r = check_inc02_non_inclusive_tech("Replicate from master database")
        assert r.is_violation

    def test_git_master(self):
        r = check_inc02_non_inclusive_tech("git push to master")
        assert r.is_violation

    def test_merge_to_master(self):
        r = check_inc02_non_inclusive_tech("Merge to master before release")
        assert r.is_violation

    def test_master_slave(self):
        r = check_inc02_non_inclusive_tech("master slave replication")
        assert r.is_violation

    # --- Defers (ambiguous context) ---

    def test_mastery_no_fp(self):
        r = check_inc02_non_inclusive_tech("Achieve mastery of the platform")
        assert r.is_defer

    def test_master_bedroom_no_fp(self):
        r = check_inc02_non_inclusive_tech("The master bedroom is upstairs")
        assert r.is_defer

    def test_master_class_no_fp(self):
        r = check_inc02_non_inclusive_tech("Join our master class on design")
        assert r.is_defer

    def test_masters_degree_no_fp(self):
        r = check_inc02_non_inclusive_tech("She holds a master's degree")
        assert r.is_defer

    def test_master_plan_no_fp(self):
        r = check_inc02_non_inclusive_tech("The master plan is ready")
        assert r.is_defer

    # --- Other INC-02 terms still work ---

    def test_whitelist_still_flags(self):
        r = check_inc02_non_inclusive_tech("Add to the whitelist")
        assert r.is_violation

    def test_blacklist_still_flags(self):
        r = check_inc02_non_inclusive_tech("On our blacklist")
        assert r.is_violation

    def test_grandfathered_still_flags(self):
        r = check_inc02_non_inclusive_tech("Your plan is grandfathered")
        assert r.is_violation

    def test_slave_still_flags(self):
        r = check_inc02_non_inclusive_tech("Configure the slave database")
        assert r.is_violation


# ═══════════════════════════════════════════════════════════════════════
# Action checks
# ═══════════════════════════════════════════════════════════════════════


# --- ACT-01: Binary response pass-only check ---


class TestAct01BinaryResponses:
    """Binary response buttons should get ACT-01 PASS from the preprocessor.

    Source: test_triage_fixes.py
    """

    # --- Passes (exact matches) ---

    def test_yes(self):
        r = check_act01_binary_responses("Yes")
        assert r.is_pass
        assert r.standard_id == "ACT-01"

    def test_no(self):
        r = check_act01_binary_responses("No")
        assert r.is_pass

    def test_ok(self):
        r = check_act01_binary_responses("OK")
        assert r.is_pass

    def test_okay(self):
        r = check_act01_binary_responses("Okay")
        assert r.is_pass

    def test_cancel(self):
        r = check_act01_binary_responses("Cancel")
        assert r.is_pass

    def test_dismiss(self):
        r = check_act01_binary_responses("Dismiss")
        assert r.is_pass

    def test_got_it(self):
        r = check_act01_binary_responses("Got it")
        assert r.is_pass

    def test_not_now(self):
        r = check_act01_binary_responses("Not now")
        assert r.is_pass

    def test_maybe_later(self):
        r = check_act01_binary_responses("Maybe later")
        assert r.is_pass

    def test_no_thanks(self):
        r = check_act01_binary_responses("No thanks")
        assert r.is_pass

    def test_allow(self):
        r = check_act01_binary_responses("Allow")
        assert r.is_pass

    def test_deny(self):
        r = check_act01_binary_responses("Deny")
        assert r.is_pass

    def test_accept(self):
        r = check_act01_binary_responses("Accept")
        assert r.is_pass

    def test_decline(self):
        r = check_act01_binary_responses("Decline")
        assert r.is_pass

    def test_skip(self):
        r = check_act01_binary_responses("Skip")
        assert r.is_pass

    # --- Passes (case insensitive) ---

    def test_yes_lowercase(self):
        r = check_act01_binary_responses("yes")
        assert r.is_pass

    def test_ok_mixed_case(self):
        r = check_act01_binary_responses("Ok")
        assert r.is_pass

    # --- Passes (compound confirmations) ---

    def test_yes_delete(self):
        r = check_act01_binary_responses("Yes, delete")
        assert r.is_pass

    def test_ok_remove(self):
        r = check_act01_binary_responses("OK, remove")
        assert r.is_pass

    def test_no_keep_editing(self):
        r = check_act01_binary_responses("No, keep editing")
        assert r.is_pass

    def test_yes_without_comma(self):
        """'Yes delete' (no comma) is also a valid compound confirmation."""
        r = check_act01_binary_responses("Yes delete")
        assert r.is_pass

    def test_ok_remove_it(self):
        r = check_act01_binary_responses("OK, remove it")
        assert r.is_pass

    # --- Passes (whitespace handling) ---

    def test_leading_trailing_whitespace(self):
        """Whitespace around the text shouldn't prevent matching."""
        r = check_act01_binary_responses("  Yes  ")
        assert r.is_pass

    # --- Defers (not binary responses) ---

    def test_regular_button_defers(self):
        """Normal button text should defer to LLM for ACT-01."""
        r = check_act01_binary_responses("Save changes")
        assert r.is_defer

    def test_long_sentence_starting_with_yes(self):
        """The 5-word guard prevents false passes on sentences."""
        r = check_act01_binary_responses("Yes we have a comprehensive guide for new users")
        assert r.is_defer

    def test_question_defers(self):
        r = check_act01_binary_responses("Are you sure you want to delete?")
        assert r.is_defer

    def test_empty_string_defers(self):
        r = check_act01_binary_responses("")
        assert r.is_defer

    def test_generic_text_defers(self):
        r = check_act01_binary_responses("Your account has been updated")
        assert r.is_defer

    # --- Integration: ACT-01 registered in preprocess() ---

    def test_act01_in_preprocess_results(self):
        """ACT-01 should appear in the preprocess results list."""
        results = preprocess("Yes", "button_cta")
        act01_results = [r for r in results if r.standard_id == "ACT-01"]
        assert len(act01_results) == 1
        assert act01_results[0].is_pass

    def test_act01_defer_in_preprocess(self):
        """Non-binary text should defer ACT-01 in the preprocess results."""
        results = preprocess("Save changes", "button_cta")
        act01_results = [r for r in results if r.standard_id == "ACT-01"]
        assert len(act01_results) == 1
        assert act01_results[0].is_defer


# ═══════════════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════════════
# Real-world regression cases
# ═══════════════════════════════════════════════════════════════════════


class TestRealWorldCases:
    """Test against actual cases from the eval dataset.

    These are the cases that drove the preprocessor design.

    Source: test_preprocess.py
    """

    # --- Kaiser Permanente cases ---

    def test_kp_individual_family_ampersand_heading(self):
        """GRM-04 kp ampersand heading individual-family: heading passes."""
        r = check_grm04_ampersands("Individual & family plans", "heading")
        assert r.outcome == Outcome.PASS

    def test_kp_doctors_locations_ampersand_nav(self):
        """GRM-04 kp ampersand nav doctors-locations: nav passes."""
        r = check_grm04_ampersands("Doctors & Locations", "ui_label")
        assert r.outcome == Outcome.PASS

    def test_kp_zip_code_abbreviation(self):
        """GRM-02 kp unexpanded-acronym zip: ZIP is universal."""
        r = check_grm02_abbreviations("Enter a 5-digit ZIP code to get started.")
        assert r.outcome == Outcome.PASS

    def test_kp_tty_abbreviation(self):
        """GRM-02 kp unexpanded-acronym tty: TTY is a regulated term."""
        r = check_grm02_abbreviations("Call 1-888-740-7915 (TTY 711)")
        assert r.outcome == Outcome.PASS

    def test_kp_internal_abbreviation_defers(self):
        """GRM-02 kp unexpanded-acronym kp-footer: KP is internal."""
        r = check_grm02_abbreviations("About KP")
        assert r.outcome == Outcome.DEFER

    # --- Stripe cases ---

    def test_stripe_products_pricing_ampersand_heading(self):
        """GRM-04 stripe ampersand footer products-pricing: heading passes."""
        r = check_grm04_ampersands("Products & pricing", "heading")
        assert r.outcome == Outcome.PASS

    def test_stripe_llc_abbreviation(self):
        """GRM-02 stripe unexpanded-acronym pass llc: LLC is universal."""
        r = check_grm02_abbreviations("LLC, partnership, or corporation")
        assert r.outcome == Outcome.PASS

    def test_stripe_ml_abbreviation_defers(self):
        """GRM-02 stripe unexpanded-acronym pass ml: ML is NOT universal."""
        r = check_grm02_abbreviations(
            "Reduce fraud and increase revenue with ML optimizations."
        )
        assert r.outcome == Outcome.DEFER

    # --- Novel eval cases ---

    def test_novel_missing_oxford_comma(self):
        """GRM-01 novel missing oxford comma: should be caught."""
        r = check_grm01_oxford_comma(
            "You can track orders, manage returns and contact support from your account page."
        )
        assert r.outcome == Outcome.VIOLATION

    def test_novel_oxford_comma_present(self):
        """GRM-01 novel oxford comma pass: correct list defers."""
        r = check_grm01_oxford_comma(
            "You can track orders, manage returns, and contact support from your account page."
        )
        assert r.outcome == Outcome.DEFER

    def test_novel_spelled_out_numbers(self):
        """GRM-05 novel spelled out numbers: should be caught."""
        r = check_grm05_numerals(
            "You have two new notifications and five pending requests."
        )
        assert r.outcome == Outcome.VIOLATION

    def test_novel_sentence_start_number(self):
        """GRM-05 novel number starts sentence pass: correctly spelled out."""
        r = check_grm05_numerals("Twelve users are currently online.")
        assert r.outcome == Outcome.PASS

    def test_novel_brand_ampersand(self):
        """GRM-04 novel brand ampersand pass: AT&T is a brand."""
        r = check_grm04_ampersands("Powered by AT&T", "short_ui_copy")
        assert r.outcome == Outcome.PASS


# ═══════════════════════════════════════════════════════════════════════
# Integration tests
# ═══════════════════════════════════════════════════════════════════════


class TestPreprocessIntegration:
    """Pipeline integration: check counts, wiring, multi-violation detection.

    Consolidated from: test_preprocess.py, test_apple_patches.py
    """

    def test_returns_results_for_all_checks(self):
        results = preprocess("Hello world", "short_ui_copy")
        standard_ids = {r.standard_id for r in results}
        assert "GRM-03" in standard_ids
        assert "GRM-04" in standard_ids
        assert "GRM-01" in standard_ids
        assert "GRM-05" in standard_ids
        assert "CON-03" in standard_ids
        assert "GRM-02" in standard_ids

    def test_get_preprocess_violations_filters(self):
        results = preprocess(
            "Read our terms & conditions for more details!!",
            "short_ui_copy",
        )
        violations = get_preprocess_violations(results)
        violation_ids = {v["standard_id"] for v in violations}
        assert "GRM-04" in violation_ids
        assert "GRM-03" in violation_ids

    def test_get_suppressed_standards(self):
        results = preprocess("Enter your ZIP code.", "ui_label")
        suppressed = get_suppressed_standards(results)
        assert "GRM-02" in suppressed
        assert "GRM-04" in suppressed

    def test_ampersand_heading_not_flagged(self):
        results = preprocess("Products & pricing", "heading")
        violations = get_preprocess_violations(results)
        violation_ids = {v["standard_id"] for v in violations}
        assert "GRM-04" not in violation_ids

    def test_ampersand_body_flagged(self):
        results = preprocess(
            "Review our terms & conditions before proceeding.",
            "short_ui_copy",
        )
        violations = get_preprocess_violations(results)
        violation_ids = {v["standard_id"] for v in violations}
        assert "GRM-04" in violation_ids

    def test_total_check_count(self):
        results = preprocess("Hello world", "short_ui_copy")
        assert len(results) == 25

    def test_clean_copy_no_violations(self):
        results = preprocess("Save your changes", "short_ui_copy")
        violations = [r for r in results if r.is_violation]
        assert len(violations) == 0

    def test_multiple_violations_from_different_checks(self):
        """A single string can trigger multiple independent checks."""
        results = preprocess(
            "Click here in order to utilize the DASHBOARD",
            "short_ui_copy",
        )
        violations = [r for r in results if r.is_violation]
        ids = {v.standard_id for v in violations}
        assert "ACC-01" in ids
        assert "CLR-01" in ids

    def test_phase3_checks_included(self):
        """Verify Phase 3 checks are registered in the entry point."""
        results = preprocess("Use e.g. this format", "short_ui_copy")
        ids = {r.standard_id for r in results}
        assert "PRF-10" in ids
        assert "PRF-11" in ids

    def test_latin_abbreviation_fires_in_pipeline(self):
        results = preprocess("Enter a value, e.g. 42", "short_ui_copy")
        violations = [r for r in results if r.is_violation]
        assert any(v.standard_id == "PRF-10" for v in violations)

    def test_dismissive_fires_in_pipeline(self):
        results = preprocess("Simply enter your email", "short_ui_copy")
        violations = [r for r in results if r.is_violation]

    def test_check_count(self):
        """Preprocessor runs exactly 25 checks."""
        results = preprocess("Test string", "short_ui_copy")
        assert len(results) == 25

    def test_all_checks_return_preprocess_result(self):
        results = preprocess("Test string", "short_ui_copy")
        for r in results:
            assert isinstance(r, PreprocessResult)

    def test_clean_text_all_defer(self):
        """Clean text should produce mostly DEFER results."""
        results = preprocess("Save your changes", "button_label")
        violations = [r for r in results if r.is_violation]
        assert len(violations) == 0

    def test_check_count_25(self):
        """Canary test — if this changes, a check was added or removed."""
        results = preprocess("Hello world", "short_ui_copy")
        assert len(results) == 25

    def test_all_checks_have_standard_ids(self):
        """Every check result must carry a standard_id."""
        results = preprocess("Test content", "short_ui_copy")
        for r in results:
            assert r.standard_id, f"Check missing standard_id: {r}"

    def test_all_outcomes_valid(self):
        """Every check result must use a recognized outcome."""
        results = preprocess("Test content", "short_ui_copy")
        valid = {Outcome.VIOLATION, Outcome.PASS, Outcome.DEFER}
        for r in results:
            assert r.outcome in valid, f"Invalid outcome for {r.standard_id}: {r.outcome}"


class TestPreprocessIntegrationFull:
    """Test that all checks are present in preprocess() output.

    Source: test_preprocess.py
    """

    def test_returns_all_13_checks(self):
        results = preprocess("Hello world", "short_ui_copy")
        standard_ids = {r.standard_id for r in results}
        assert "GRM-03" in standard_ids
        assert "GRM-04" in standard_ids
        assert "GRM-01" in standard_ids
        assert "GRM-05" in standard_ids
        assert "CON-03" in standard_ids
        assert "GRM-02" in standard_ids
        assert "PRF-01" in standard_ids
        assert "PRF-02" in standard_ids
        assert "PRF-03" in standard_ids
        assert "PRF-04" in standard_ids
        assert "PRF-05" in standard_ids
        assert "PRF-06" in standard_ids
        assert "PRF-07" in standard_ids
        assert len(results) == 25

    def test_multiple_proofing_violations_caught(self):
        """A string with several proofing errors should catch them all."""
        results = preprocess(
            " Click here .Then  save and and continue ",
            "short_ui_copy",
        )
        violations = get_preprocess_violations(results)
        violation_ids = {v["standard_id"] for v in violations}
        assert "PRF-06" in violation_ids
        assert "PRF-07" in violation_ids
        assert "PRF-01" in violation_ids
        assert "PRF-02" in violation_ids
