"""Tests for the classifier fix from v4.3.1 triage.

Patch 3: Classifier "problem"/"issue" removal (Cluster 6 false positives)

Preprocessor patches (PRF-01 data display, ACT-01 binary responses)
moved to test_preprocess.py during M2 consolidation.
"""

import pytest
from content_checker.classify import classify_heuristic


# =========================================================================
# Classifier "problem"/"issue" removal
# =========================================================================

class TestClassifierProblemRemoval:
    """'problem' and 'issue' should no longer trigger error_message classification."""

    def test_problem_in_instructional_text(self):
        """The triggering case from Opendoor triage Cluster 6."""
        result = classify_heuristic(
            "Make arguments — Convince your audience they should care about the problem"
        )
        assert result != "error_message"

    def test_issue_in_normal_text(self):
        result = classify_heuristic("This issue affects all users")
        assert result != "error_message"

    def test_problem_standalone(self):
        result = classify_heuristic("There is a problem with your request")
        assert result != "error_message"

    def test_real_error_still_caught(self):
        """Error messages with genuine error signals must still be caught."""
        result = classify_heuristic("Error: Something went wrong")
        assert result == "error_message"

    def test_couldnt_error_still_caught(self):
        result = classify_heuristic("Couldn't save your changes")
        assert result == "error_message"

    def test_unable_error_still_caught(self):
        result = classify_heuristic("Unable to load your profile")
        assert result == "error_message"

    def test_oops_error_still_caught(self):
        result = classify_heuristic("Oops! Something went wrong.")
        assert result == "error_message"

    def test_sorry_error_still_caught(self):
        result = classify_heuristic("Sorry, we couldn't process that")
        assert result == "error_message"

    def test_unexpected_error_still_caught(self):
        result = classify_heuristic("An unexpected error occurred")
        assert result == "error_message"

    def test_fail_error_still_caught(self):
        result = classify_heuristic("Payment failed")
        assert result == "error_message"
