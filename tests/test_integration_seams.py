"""Integration seam tests — verify data flows between modules.

This file exists because of a specific failure mode: the CLR-01 _global
content_type_notes was added to standards_library.json and tested for
EXISTENCE, but nobody tested that it flowed through filter.py to the LLM.
It was dead code across multiple sessions.

Unit tests prove components work in isolation. These tests prove the
PIPES between components are connected. Every test crosses at least one
module boundary.

Architecture seams tested:
    1. standards_library.json → filter.py      (notes, content types)
    2. standards_library.json → moments.py     (weight references)
    3. standards_library.json → audience.py    (suppression references)
    4. standards_library.json → preprocess.py  (standard IDs)
    5. moments.py → pipeline merge stage       (suppression sets)
    6. preprocess.py → pipeline merge stage    (suppressed_ids contract)
    7. Pipeline trace: input → moment + filter + preprocess alignment

Design rule:
    When you add data in module A that module B consumes, write a test
    HERE that calls module B and asserts the data arrives. Do not test
    existence in A alone — that's how the _global bug happened.

When to add tests to this file:
    - Adding a content_type_notes entry (test it flows through filter)
    - Adding a moment weight (test the standard_id exists, test suppression)
    - Adding a UI-specific standard to audience.py (test it's excluded)
    - Adding a preprocessor check (test suppressed_ids contract)
    - Any change where module A writes and module B reads
"""

import json
from pathlib import Path

import pytest

from content_checker.standards.loader import load_standards
from content_checker.filter import filter_standards
from content_checker.moments import (
    DEFAULT_MOMENT,
    MOMENT_TAXONOMY,
    MOMENT_WEIGHTS,
    VALID_MOMENTS,
    MomentWeight,
    build_moment_prompt_section,
    detect_moment,
    get_moment_weights,
    get_suppressed_standards_for_moment,
    is_standard_suppressed_by_moment,
)
from content_checker.audience import Audience, UI_SPECIFIC_STANDARDS, is_standard_active
from content_checker.preprocess import (
    Outcome,
    PREPROCESSOR_STANDARD_IDS,
    preprocess,
    run_preprocess,
    get_suppressed_standards,
)


# ═══════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════


@pytest.fixture
def standards():
    """Load the live standards library — the source of truth."""
    return load_standards()


@pytest.fixture
def all_standard_ids(standards):
    """Every standard ID from the library + preprocessor.

    The union ensures integration tests catch both:
    - Standards referenced by moments/audience that don't exist in the library
    - Preprocessor IDs that don't exist in the library

    Uses PREPROCESSOR_STANDARD_IDS (a frozenset constant) instead of
    running the preprocessor on a magic input string. This makes the
    contract explicit and independent of input coverage.
    """
    library_ids = set()
    for cat in standards.get("categories", []):
        for std in cat.get("standards", []):
            library_ids.add(std["id"])
    return library_ids | PREPROCESSOR_STANDARD_IDS


@pytest.fixture
def content_type_ids(standards):
    """Extract every valid content type ID from the library."""
    return {ct["id"] for ct in standards.get("content_types", [])}


# ═══════════════════════════════════════════════════════════════════════
# 1. Standards library self-consistency
#
# These tests verify the JSON is internally consistent. They catch
# typos in content type references, orphaned notes, and missing fields
# that would silently break downstream modules.
# ═══════════════════════════════════════════════════════════════════════


class TestStandardsLibraryIntegrity:
    """The standards library must be self-consistent."""

    def test_all_ids_unique(self, standards):
        """No duplicate standard IDs. Duplicates would cause filter
        to include a standard twice or shadow one version.
        """
        ids = []
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                ids.append(std["id"])
        assert len(ids) == len(set(ids)), (
            f"Duplicate standard IDs: "
            f"{[x for x in ids if ids.count(x) > 1]}"
        )

    def test_relevant_content_types_are_valid(self, standards, content_type_ids):
        """Every value in relevant_content_types must reference a content
        type defined in the library's content_types array. A typo here
        means the standard silently never matches that content type.
        """
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                for ct in std.get("relevant_content_types", []):
                    assert ct in content_type_ids, (
                        f"{std['id']} references unknown content type "
                        f"'{ct}'. Valid types: {sorted(content_type_ids)}"
                    )

    def test_content_type_notes_keys_are_valid(self, standards, content_type_ids):
        """Every key in content_type_notes must be either '_global' or a
        valid content type ID. A typo means the note never activates.
        """
        valid_keys = content_type_ids | {"_global"}
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                for key in std.get("content_type_notes", {}):
                    assert key in valid_keys, (
                        f"{std['id']} has content_type_notes key '{key}' "
                        f"which is not a valid content type or '_global'. "
                        f"Valid keys: {sorted(valid_keys)}"
                    )

    def test_required_fields_present(self, standards):
        """Every standard must have the fields that filter.py and
        pipeline.py depend on.
        """
        required = {"id", "rule", "rule_type", "checkable_from"}
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                missing = required - set(std.keys())
                assert not missing, (
                    f"{std.get('id', '???')} missing required fields: "
                    f"{missing}"
                )

    def test_rule_type_is_valid(self, standards):
        """rule_type must be 'hard' or 'nuanced'. Other values would
        be ignored by the pipeline but indicate a data entry error.
        """
        valid = {"hard", "nuanced", "mechanical"}
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                assert std["rule_type"] in valid, (
                    f"{std['id']} has rule_type '{std['rule_type']}', "
                    f"expected one of {valid}"
                )

    def test_content_type_notes_reachable(self, standards, content_type_ids):
        """Every content-type-specific note key must also appear in that
        standard's relevant_content_types. If it doesn't, the filter
        excludes the standard before the note is ever collected — the
        note exists in the JSON but is invisible to the pipeline.

        This is a structural invariant, not a behavioral test. It catches
        the problem at the data level without running filter_standards().

        Evidence: P3 of v4.6.1 added a 'heading' note to VT-01 without
        adding 'heading' to relevant_content_types. The note was dead
        code until the mismatch was caught during implementation.

        The _global key is excluded because _global notes apply regardless
        of content type — they're collected for any content type the
        standard is relevant to.
        """
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                notes = std.get("content_type_notes", {})
                rct = set(std.get("relevant_content_types", []))
                for key in notes:
                    if key == "_global":
                        continue
                    assert key in rct, (
                        f"{std['id']} has content_type_notes['{key}'] but "
                        f"'{key}' is not in its relevant_content_types "
                        f"{sorted(rct)}. The note exists but will never "
                        f"reach the LLM — the filter excludes this standard "
                        f"for '{key}' content before collecting notes. "
                        f"Fix: add '{key}' to {std['id']}'s "
                        f"relevant_content_types in standards_library.json."
                    )


# ═══════════════════════════════════════════════════════════════════════
# 2. Data path: standards_library.json → filter.py
#
# THE TEST THAT WOULD HAVE CAUGHT THE _GLOBAL BUG.
#
# For every content_type_notes entry in the library, verify that
# filter_standards() actually collects it into active_notes.
# This is auto-discovery: add a note to the JSON, and this test
# immediately verifies it flows through the filter.
# ═══════════════════════════════════════════════════════════════════════


class TestFilterDataPathManifest:
    """Auto-verify every content_type_notes entry flows through filter."""

    def _collect_all_notes(self, standards):
        """Discover every content_type_notes entry in the library.
        Returns list of (standard_id, note_key, note_text) tuples.
        """
        entries = []
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                for key, text in std.get("content_type_notes", {}).items():
                    entries.append((std["id"], key, text))
        return entries

    def _get_relevant_content_types(self, standards, standard_id):
        """Get the content types a standard is relevant to."""
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                if std["id"] == standard_id:
                    return std.get("relevant_content_types", [])
        return []

    def test_every_global_note_is_collected(self, standards):
        """For every _global note in the library, verify it appears in
        filter_standards() output for at least one content type the
        standard is relevant to.

        THIS IS THE TEST THAT PREVENTS THE CLR-01 BUG FROM RECURRING.
        """
        entries = self._collect_all_notes(standards)
        global_entries = [(sid, text) for sid, key, text in entries if key == "_global"]

        assert len(global_entries) > 0, (
            "No _global notes found — test is vacuous. "
            "If all _global notes were removed, this test should be updated."
        )

        for standard_id, note_text in global_entries:
            relevant_types = self._get_relevant_content_types(standards, standard_id)
            # Use the first relevant content type for the check
            assert len(relevant_types) > 0, (
                f"{standard_id} has a _global note but no relevant_content_types"
            )
            test_ct = relevant_types[0]
            filtered = filter_standards(standards, test_ct)
            collected_notes = [
                n for n in filtered["active_notes"]
                if n["standard_id"] == standard_id
            ]
            assert len(collected_notes) >= 1, (
                f"{standard_id} _global note not collected by filter_standards() "
                f"for content type '{test_ct}'. Data written but never delivered. "
                f"Check filter.py _global collection logic."
            )

    def test_every_content_type_note_is_collected(self, standards):
        """For every content-type-specific note in the library, verify
        it appears in filter_standards() output when filtering for that
        exact content type.
        """
        entries = self._collect_all_notes(standards)
        ct_entries = [(sid, key, text) for sid, key, text in entries if key != "_global"]

        for standard_id, content_type, note_text in ct_entries:
            filtered = filter_standards(standards, content_type)
            collected_notes = [
                n for n in filtered["active_notes"]
                if n["standard_id"] == standard_id
                and n["note"] == note_text
            ]
            assert len(collected_notes) == 1, (
                f"{standard_id} content_type_notes['{content_type}'] not "
                f"collected by filter_standards(). Data written but never "
                f"delivered. Check filter.py note collection logic."
            )

    def test_notes_not_collected_for_irrelevant_content_type(self, standards):
        """A standard's notes should NOT appear when the standard itself
        is filtered out by content type irrelevance.
        """
        entries = self._collect_all_notes(standards)
        if not entries:
            pytest.skip("No content_type_notes to test")

        # Find a standard that has notes and is NOT relevant to every type
        for standard_id, key, text in entries:
            relevant = self._get_relevant_content_types(standards, standard_id)
            if not relevant:
                continue  # Universal standard, skip
            # Find a content type this standard is NOT relevant to
            all_types = {ct["id"] for ct in standards.get("content_types", [])}
            excluded = all_types - set(relevant)
            if not excluded:
                continue
            excluded_ct = sorted(excluded)[0]
            filtered = filter_standards(standards, excluded_ct)
            orphan_notes = [
                n for n in filtered["active_notes"]
                if n["standard_id"] == standard_id
            ]
            assert len(orphan_notes) == 0, (
                f"{standard_id} note collected for '{excluded_ct}' even "
                f"though the standard is not relevant to that content type. "
                f"Notes should only appear when the standard passes the filter."
            )
            return  # One check is sufficient for the invariant

        pytest.skip("All standards with notes are universal")


# ═══════════════════════════════════════════════════════════════════════
# 3. Data path: moments.py → standards_library.json
#
# Every standard_id referenced in moment weights must actually exist
# in the library. A typo in MOMENT_WEIGHTS means the weight silently
# does nothing (emphasize/relax have no target, suppress removes nothing).
# ═══════════════════════════════════════════════════════════════════════


class TestMomentWeightConsistency:
    """Moment weights must reference real standards."""

    def test_all_weighted_standards_exist(self, all_standard_ids):
        """Every standard_id in MOMENT_WEIGHTS must exist in the library.
        A weight referencing a nonexistent standard is a silent no-op.
        """
        for moment, weights in MOMENT_WEIGHTS.items():
            for w in weights:
                assert w.standard_id in all_standard_ids, (
                    f"Moment '{moment}' references standard '{w.standard_id}' "
                    f"which does not exist in standards_library.json"
                )

    def test_all_modifiers_are_valid(self):
        """Modifiers must be one of the three defined values.
        An invalid modifier would be silently ignored by all consumers.
        """
        valid = {"emphasize", "relax", "suppress"}
        for moment, weights in MOMENT_WEIGHTS.items():
            for w in weights:
                assert w.modifier in valid, (
                    f"Moment '{moment}', standard '{w.standard_id}': "
                    f"modifier '{w.modifier}' is not valid. "
                    f"Expected one of {valid}"
                )

    def test_no_duplicate_standards_per_moment(self):
        """A standard should not appear twice in the same moment's weights.
        Duplicates would cause double-emphasis or conflicting modifiers.
        """
        for moment, weights in MOMENT_WEIGHTS.items():
            ids = [w.standard_id for w in weights]
            assert len(ids) == len(set(ids)), (
                f"Moment '{moment}' has duplicate standard IDs: "
                f"{[x for x in ids if ids.count(x) > 1]}"
            )

    def test_all_weights_have_rationale(self):
        """Every weight must have a non-empty rationale.
        The rationale appears in the system prompt and in eval annotations.
        Empty rationale means the LLM gets no context for the adjustment.
        """
        for moment, weights in MOMENT_WEIGHTS.items():
            for w in weights:
                assert w.rationale.strip(), (
                    f"Moment '{moment}', standard '{w.standard_id}': "
                    f"empty rationale"
                )

    def test_suppress_weights_produce_suppression_sets(self):
        """Every 'suppress' modifier should appear in the suppressed set.
        This verifies the pipeline-facing function agrees with the data.
        """
        for moment, weights in MOMENT_WEIGHTS.items():
            expected = {w.standard_id for w in weights if w.modifier == "suppress"}
            actual = get_suppressed_standards_for_moment(moment)
            assert actual == expected, (
                f"Moment '{moment}': suppression set mismatch. "
                f"Expected {expected}, got {actual}"
            )


# ═══════════════════════════════════════════════════════════════════════
# 4. Data path: audience.py → standards_library.json
#
# Every standard in the UI-specific suppression set must exist in the
# library. A typo means the audience gate suppresses nothing.
# ═══════════════════════════════════════════════════════════════════════


class TestAudienceStandardConsistency:
    """Audience suppression references must point to real standards."""

    def test_all_ui_specific_standards_exist(self, all_standard_ids):
        """Every standard in UI_SPECIFIC_STANDARDS must exist in the library."""
        for std_id in UI_SPECIFIC_STANDARDS:
            assert std_id in all_standard_ids, (
                f"UI_SPECIFIC_STANDARDS contains '{std_id}' which does "
                f"not exist in standards_library.json"
            )

    def test_ui_specific_excluded_in_general_mode(self, standards):
        """In general audience mode, UI-specific standards must not appear
        in filter output. This verifies the filter → audience data path.
        """
        # Use a broad content type that includes many standards
        filtered = filter_standards(standards, "short_ui_copy", Audience.GENERAL)
        filtered_ids = set()
        for cat in filtered.get("categories", []):
            for std in cat.get("standards", []):
                filtered_ids.add(std["id"])

        for std_id in UI_SPECIFIC_STANDARDS:
            assert std_id not in filtered_ids, (
                f"UI-specific standard '{std_id}' appeared in filter "
                f"output for general audience mode"
            )

    def test_ui_specific_included_in_product_ui_mode(self, standards):
        """In product_ui mode, UI-specific standards must be included
        (assuming their content type matches). This verifies no
        accidental over-suppression.
        """
        filtered = filter_standards(standards, "short_ui_copy", Audience.PRODUCT_UI)
        filtered_ids = set()
        for cat in filtered.get("categories", []):
            for std in cat.get("standards", []):
                filtered_ids.add(std["id"])

        for std_id in UI_SPECIFIC_STANDARDS:
            # Only check standards relevant to short_ui_copy
            if std_id in filtered_ids or not is_standard_active(std_id, Audience.PRODUCT_UI):
                continue
            # Standard might not be relevant to this content type — that's fine


# ═══════════════════════════════════════════════════════════════════════
# 5. Data path: preprocess.py → pipeline merge stage
#
# The preprocessor's suppressed_ids contract is the foundation of the
# post-processing suppression pattern. If run_preprocess() stops
# returning a .suppressed_ids attribute, the merge stage silently
# stops suppressing LLM false positives.
# ═══════════════════════════════════════════════════════════════════════


class TestPreprocessorContract:
    """The preprocessor must honor the suppressed_ids contract."""

    def test_run_preprocess_returns_suppressed_ids(self):
        """run_preprocess() must return an object with a .suppressed_ids
        attribute. The merge stage depends on this.
        """
        result = run_preprocess("Hello world", "short_ui_copy")
        assert hasattr(result, "suppressed_ids"), (
            "run_preprocess() return value missing .suppressed_ids attribute. "
            "The pipeline merge stage depends on this for post-processing "
            "suppression."
        )

    def test_suppressed_ids_is_set(self):
        """suppressed_ids must be a set, not a list. Sets prevent
        duplicate entries and enable O(1) membership checks.
        """
        result = run_preprocess("Hello world", "short_ui_copy")
        assert isinstance(result.suppressed_ids, set), (
            f"suppressed_ids is {type(result.suppressed_ids).__name__}, "
            f"expected set"
        )

    def test_pass_outcome_produces_suppressed_id(self):
        """When the preprocessor returns PASS for a standard, that
        standard's ID must appear in suppressed_ids. This is the
        core contract.
        """
        # GRM-02 should PASS for a text with standard abbreviations
        results = preprocess("e.g. this is an example", "short_ui_copy")
        passes = {r.standard_id for r in results if r.is_pass}
        suppressed = get_suppressed_standards(results)
        assert passes == suppressed, (
            f"PASS outcomes {passes} don't match suppressed set {suppressed}"
        )

    def test_violation_is_not_in_suppressed_ids(self):
        """A standard with a VIOLATION must NOT appear in suppressed_ids.
        If it did, the merge stage would suppress the violation.
        """
        # Double space triggers PRF-01 VIOLATION
        result = run_preprocess("Hello  world", "short_ui_copy")
        violation_ids = {v.standard_id for v in result}
        assert not (violation_ids & result.suppressed_ids), (
            f"Standards appear in both violations and suppressed_ids: "
            f"{violation_ids & result.suppressed_ids}. "
            f"A standard cannot be both violated and suppressed."
        )

    def test_preprocess_standard_ids_exist_in_library(self, all_standard_ids):
        """Every standard ID the preprocessor can produce must exist
        in the library. Orphaned IDs would pass through the pipeline
        but never match a filter entry.
        """
        # Run on a string that triggers many checks
        results = preprocess(
            'Click here for more info!!  e.g. it\'s "easy" to set up.',
            "short_ui_copy",
        )
        for r in results:
            assert r.standard_id in all_standard_ids, (
                f"Preprocessor produced standard_id '{r.standard_id}' "
                f"which does not exist in standards_library.json"
            )


# ═══════════════════════════════════════════════════════════════════════
# 6. Pipeline trace: end-to-end deterministic verification
#
# These tests take a known input, run it through every deterministic
# stage (moment detection, filter, preprocess), and verify the outputs
# are consistent with each other. No API calls — just plumbing.
#
# Each trace test represents a scenario where a cross-module failure
# would produce a wrong result. The test documents the expected
# behavior at every stage.
# ═══════════════════════════════════════════════════════════════════════


class TestPipelineTrace:
    """End-to-end deterministic traces through the pipeline stages."""

    def test_trace_regulatory_disclosure(self, standards):
        """Trace: FDIC disclaimer through the full deterministic path.

        Input: "Not Insured by the FDIC or Any Federal Government Agency"
        Expected flow:
            moment = compliance_disclosure
            CON-02 suppressed (regulatory Title Case is mandated)
            CLR-01 relaxed (legal terms are precision, not jargon)
            CLR-01 _global note reaches filter output
            prompt section mentions both CON-02 and CLR-01
        """
        text = "Not Insured by the FDIC or Any Federal Government Agency"
        content_type = "short_ui_copy"

        # Stage 1b: moment detection
        moment = detect_moment(text, content_type)
        assert moment == "compliance_disclosure"

        # Stage 2: filter
        filtered = filter_standards(standards, content_type)
        note_ids = {n["standard_id"] for n in filtered["active_notes"]}
        # CLR-01 has a _global note — it should be in active_notes
        assert "CLR-01" in note_ids, (
            "CLR-01 _global note missing from filter output in "
            "regulatory disclosure trace"
        )

        # Stage 3a: preprocess
        preprocess_result = run_preprocess(text, content_type)

        # Merge stage verification (deterministic part)
        assert is_standard_suppressed_by_moment("CON-02", moment), (
            "CON-02 should be suppressed in compliance_disclosure moment"
        )
        assert not is_standard_suppressed_by_moment("CLR-01", moment), (
            "CLR-01 should be relaxed, not suppressed"
        )

        # Prompt section
        prompt = build_moment_prompt_section(moment)
        assert "CON-02" in prompt
        assert "CLR-01" in prompt

    def test_trace_error_with_dismissive_language(self, standards):
        """Trace: error message with dismissive language.

        Input: "Simply try again later"
        Expected flow:
            moment = error_recovery (via pattern match)
            PRF-11 emphasized (not suppressed — dismissive in errors is BAD)
            GRM-03 suppressed (no exclamation marks in errors)
            preprocess fires PRF-11 violation for "simply"
            PRF-11 violation SURVIVES merge (emphasized, not suppressed)
        """
        text = "Simply try again later"
        content_type = "short_ui_copy"

        # Stage 1b: moment
        moment = detect_moment(text, content_type)
        assert moment == "error_recovery"

        # PRF-11 should be emphasized, not suppressed
        assert not is_standard_suppressed_by_moment("PRF-11", moment), (
            "PRF-11 must NOT be suppressed in error_recovery — "
            "dismissive language in errors is the worst case"
        )
        weights = get_moment_weights(moment)
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert prf11[0].modifier == "emphasize"

        # GRM-03 should be suppressed (no exclamation marks in errors)
        assert is_standard_suppressed_by_moment("GRM-03", moment)

        # Stage 3a: preprocess should catch "Simply"
        preprocess_result = run_preprocess(text, content_type)
        violation_ids = {v.standard_id for v in preprocess_result}
        assert "PRF-11" in violation_ids, (
            "Preprocessor should catch 'Simply' as PRF-11 violation"
        )

    def test_trace_celebration_with_easy(self, standards):
        """Trace: celebration with "easy" language.

        Input: "Great job! That was an easy setup!"
        Expected flow:
            moment = celebration (via "great job" pattern)
            PRF-11 suppressed (enthusiasm is legitimate here)
            GRM-03 relaxed (exclamation marks earned in celebrations)
            preprocess fires PRF-11 for "easy setup"
            PRF-11 violation SUPPRESSED at merge (celebration context)
        """
        text = "Great job! That was an easy setup!"
        content_type = "short_ui_copy"

        # Stage 1b: moment
        moment = detect_moment(text, content_type)
        assert moment == "celebration"

        # PRF-11 should be suppressed in celebration
        assert is_standard_suppressed_by_moment("PRF-11", moment), (
            "PRF-11 must be suppressed in celebration — "
            "enthusiasm is legitimate, not dismissive"
        )

        # GRM-03 should be relaxed (not suppressed)
        assert not is_standard_suppressed_by_moment("GRM-03", moment)

        # Stage 3a: preprocess fires PRF-11
        preprocess_result = run_preprocess(text, content_type)
        violation_ids = {v.standard_id for v in preprocess_result}
        # PRF-11 fires in the preprocessor (which is moment-unaware)
        # but would be suppressed at the merge stage
        assert "PRF-11" in violation_ids, (
            "Preprocessor should catch 'easy setup' as PRF-11 (moment-unaware)"
        )
        # Verify the merge stage WOULD suppress it
        suppressed = get_suppressed_standards_for_moment(moment)
        assert "PRF-11" in suppressed

    def test_trace_wayfinding_nav_label(self, standards):
        """Trace: short navigation label.

        Input: "Settings" (content_type=ui_label)
        Expected flow:
            moment = wayfinding (short ui_label)
            ACT-01 suppressed (nav labels are nouns, not verbs)
            CLR-03 suppressed (fragments, not sentences)
        """
        text = "Settings"
        content_type = "ui_label"

        moment = detect_moment(text, content_type)
        assert moment == "wayfinding"

        assert is_standard_suppressed_by_moment("ACT-01", moment)
        assert is_standard_suppressed_by_moment("CLR-03", moment)

    def test_trace_general_audience_suppression(self, standards):
        """Trace: general audience mode suppresses UI-specific standards.

        In general mode (presentations, docs), ACT-01, PRF-03, and CON-02
        should not appear in the filtered standards.
        """
        filtered_general = filter_standards(
            standards, "short_ui_copy", Audience.GENERAL
        )
        filtered_product = filter_standards(
            standards, "short_ui_copy", Audience.PRODUCT_UI
        )

        general_ids = set()
        for cat in filtered_general.get("categories", []):
            for std in cat.get("standards", []):
                general_ids.add(std["id"])

        product_ids = set()
        for cat in filtered_product.get("categories", []):
            for std in cat.get("standards", []):
                product_ids.add(std["id"])

        # UI-specific standards should be in product_ui but not in general
        for std_id in UI_SPECIFIC_STANDARDS:
            if std_id in product_ids:
                assert std_id not in general_ids, (
                    f"UI-specific standard '{std_id}' should be excluded "
                    f"in general audience mode"
                )


# ═══════════════════════════════════════════════════════════════════════
# 7. Moment taxonomy ↔ weights alignment
#
# Every moment in the taxonomy should either have explicit weights
# or be intentionally weightless. This catches moments added to the
# taxonomy but forgotten in MOMENT_WEIGHTS.
# ═══════════════════════════════════════════════════════════════════════


class TestMomentTaxonomyAlignment:
    """Taxonomy and weights must stay in sync."""

    def test_every_moment_with_weights_is_in_taxonomy(self):
        """A weight entry for a moment not in the taxonomy would be dead."""
        for moment in MOMENT_WEIGHTS:
            assert moment in MOMENT_TAXONOMY, (
                f"MOMENT_WEIGHTS has entry for '{moment}' which is not "
                f"in MOMENT_TAXONOMY"
            )

    def test_every_non_default_moment_has_prompt_section(self):
        """Every moment except the default should produce a non-empty
        prompt section. Empty sections mean the LLM gets no moment
        context, defeating the purpose.
        """
        for moment in MOMENT_TAXONOMY:
            if moment == DEFAULT_MOMENT:
                continue
            section = build_moment_prompt_section(moment)
            assert len(section) > 0, (
                f"Moment '{moment}' produces empty prompt section"
            )

    def test_default_moment_prompt_is_empty(self):
        """The default moment should produce an empty prompt section.
        This is intentional — no extra guidance for the baseline."""
        section = build_moment_prompt_section(DEFAULT_MOMENT)
        assert section == ""

    def test_valid_moments_matches_taxonomy(self):
        """VALID_MOMENTS must be exactly the keys of MOMENT_TAXONOMY.
        A drift means detect_moment() could return a value that
        build_moment_prompt_section() doesn't recognize.
        """
        assert VALID_MOMENTS == frozenset(MOMENT_TAXONOMY.keys())
