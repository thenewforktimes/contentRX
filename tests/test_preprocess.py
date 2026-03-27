"""Tests for the deterministic preprocessor.

Every check must pass every test. If a check can't handle an edge case
with 100% accuracy, the check should defer to the LLM on that case.

Run: python -m pytest test_preprocess.py -v
"""

import pytest
from content_checker.preprocess import (
    Outcome,
    check_grm03_exclamation_points,
    check_grm04_ampersands,
    check_grm01_oxford_comma,
    check_grm05_numerals,
    check_con03_date_formats,
    check_grm02_abbreviations,
    check_legal_content,
    check_prf01_double_spaces,
    check_prf02_repeated_words,
    check_prf03_trailing_period_on_headings,
    check_prf04_straight_quotes,
    check_prf05_missing_space_after_punctuation,
    check_prf06_leading_trailing_whitespace,
    check_prf07_space_before_punctuation,
    preprocess,
    get_preprocess_violations,
    get_suppressed_standards,
)


# ===================================================================
# GRM-03: Exclamation points
# ===================================================================

class TestGRM03ExclamationPoints:
    """Multiple exclamation marks are always a violation. Single marks defer."""

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


# ===================================================================
# GRM-04: Ampersands
# ===================================================================

class TestGRM04Ampersands:
    """Ampersands in body copy = violation. In headings/nav = pass."""

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


# ===================================================================
# GRM-01: Oxford comma
# ===================================================================

class TestGRM01OxfordComma:
    """Missing Oxford comma in a clear 3+ item list = violation."""

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


# ===================================================================
# GRM-05: Numerals vs. spelled-out numbers
# ===================================================================

class TestGRM05Numerals:
    """Spelled-out numbers in body copy = violation, with escape hatches."""

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


# ===================================================================
# CON-03: Date formats
# ===================================================================

class TestCON03DateFormats:
    """Numeric-only dates are violations. Spelled-out months pass."""

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


# ===================================================================
# GRM-02: Abbreviation allowlist
# ===================================================================

class TestGRM02Abbreviations:
    """Known abbreviations pass. Unknown ones defer. Never flags violations."""

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


# ===================================================================
# Legal content routing
# ===================================================================

class TestLegalContentRouting:
    """Legal boilerplate should be routed away from standards checking."""

    def test_kp_legal_disclaimer_detected(self):
        text = (
            "In California, KFHP plans are offered and underwritten by "
            "Kaiser Foundation Health Plan, Inc., One Kaiser Plaza, Oakland, CA 94612."
        )
        assert check_legal_content(text) is True

    def test_kp_medicare_contract_detected(self):
        text = (
            "In California, Hawaii, and Washington, Kaiser Permanente is an "
            "HMO plan with a Medicare contract. In Colorado, Kaiser Permanente "
            "is an HMO, HMO-POS and PPO plan with Medicare contracts."
        )
        assert check_legal_content(text) is True

    def test_copyright_with_entity_detected(self):
        text = "© 2026 Kaiser Foundation Health Plan, Inc."
        assert check_legal_content(text) is True

    def test_normal_ui_copy_not_detected(self):
        """Normal UI copy should NOT be routed away."""
        assert check_legal_content("Your order shipped.") is False

    def test_single_legal_phrase_not_detected(self):
        """A single legal-sounding phrase shouldn't trigger routing."""
        assert check_legal_content("Terms and conditions") is False

    def test_footer_link_not_detected(self):
        assert check_legal_content("Terms and conditions apply") is False

    def test_regulatory_code_with_entity(self):
        text = "Y0043_N00043551_V2_M — Kaiser Foundation Health Plan, Inc."
        assert check_legal_content(text) is True


# ===================================================================
# Integration: preprocess() and helper functions
# ===================================================================

class TestPreprocessIntegration:
    """Test the main preprocess() entry point and merge helpers."""

    def test_returns_results_for_all_checks(self):
        results = preprocess("Hello world", "short_ui_copy")
        # Should return one result per check
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
        assert "GRM-04" in violation_ids  # ampersand in body copy
        assert "GRM-03" in violation_ids  # double exclamation

    def test_get_suppressed_standards(self):
        results = preprocess("Enter your ZIP code.", "ui_label")
        suppressed = get_suppressed_standards(results)
        assert "GRM-02" in suppressed  # ZIP is on the allowlist
        assert "GRM-04" in suppressed  # no ampersand present

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


# ===================================================================
# Real-world cases from the eval dataset
# ===================================================================

class TestRealWorldCases:
    """Test against actual cases from the 119-case eval dataset.

    These are the cases that drove the preprocessor design.
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

    def test_kp_legal_disclaimer_routes(self):
        """CLR-01 kp legalese state-disclaimers: legal content skips."""
        text = (
            "In California, KFHP plans are offered and underwritten by "
            "Kaiser Foundation Health Plan, Inc., One Kaiser Plaza, Oakland, "
            "CA 94612. In Colorado, all plans are offered and underwritten by "
            "Kaiser Foundation Health Plan of Colorado."
        )
        assert check_legal_content(text) is True

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


# ===================================================================
# PRF-01: Double spaces
# ===================================================================

class TestPRF01DoubleSpaces:

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


# ===================================================================
# PRF-02: Repeated words
# ===================================================================

class TestPRF02RepeatedWords:

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


# ===================================================================
# PRF-03: Trailing period on headings
# ===================================================================

class TestPRF03TrailingPeriod:

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


# ===================================================================
# PRF-04: Straight quotes
# ===================================================================

class TestPRF04StraightQuotes:

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


# ===================================================================
# PRF-05: Missing space after punctuation
# ===================================================================

class TestPRF05MissingSpaceAfterPunctuation:

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


# ===================================================================
# PRF-06: Leading/trailing whitespace
# ===================================================================

class TestPRF06LeadingTrailingWhitespace:

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


# ===================================================================
# PRF-07: Space before punctuation
# ===================================================================

class TestPRF07SpaceBeforePunctuation:

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


# ===================================================================
# Updated integration test
# ===================================================================

class TestPreprocessIntegrationFull:
    """Test that all 13 checks are present in preprocess() output."""

    def test_returns_all_13_checks(self):
        results = preprocess("Hello world", "short_ui_copy")
        standard_ids = {r.standard_id for r in results}
        # Standards-based
        assert "GRM-03" in standard_ids
        assert "GRM-04" in standard_ids
        assert "GRM-01" in standard_ids
        assert "GRM-05" in standard_ids
        assert "CON-03" in standard_ids
        assert "GRM-02" in standard_ids
        # Proofing
        assert "PRF-01" in standard_ids
        assert "PRF-02" in standard_ids
        assert "PRF-03" in standard_ids
        assert "PRF-04" in standard_ids
        assert "PRF-05" in standard_ids
        assert "PRF-06" in standard_ids
        assert "PRF-07" in standard_ids
        assert len(results) == 13

    def test_multiple_proofing_violations_caught(self):
        """A string with several proofing errors should catch them all."""
        results = preprocess(
            " Click here .Then  save and and continue ",
            "short_ui_copy",
        )
        violations = get_preprocess_violations(results)
        violation_ids = {v["standard_id"] for v in violations}
        assert "PRF-06" in violation_ids  # leading/trailing whitespace
        assert "PRF-07" in violation_ids  # space before period
        assert "PRF-01" in violation_ids  # double space
        assert "PRF-02" in violation_ids  # repeated "and and"
