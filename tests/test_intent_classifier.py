"""Tests for the Session 18 commit-message intent classifier + repo
quality scorer.

All tests are pure-logic; no network.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

EXT_DIR = Path(__file__).resolve().parent.parent / "external_signal"
if str(EXT_DIR) not in sys.path:
    sys.path.insert(0, str(EXT_DIR))

import intent_classifier as ic  # noqa: E402
import repo_quality as rq  # noqa: E402


# ═══════════════════════════════════════════════════════════════════════
# classify_intent
# ═══════════════════════════════════════════════════════════════════════


class TestClassifyIntent:
    # --- typo_fix ---

    def test_typo_fix_matches_typo(self):
        assert ic.classify_intent("fix: typo in welcome message") == "typo_fix"

    def test_typo_fix_matches_spelling(self):
        assert ic.classify_intent("fix spelling on dashboard") == "typo_fix"

    def test_typo_fix_matches_grammar(self):
        assert ic.classify_intent("docs: fix grammar in API reference") == "typo_fix"

    # --- i18n_motivated ---

    def test_i18n_prefix_matches(self):
        assert ic.classify_intent("i18n: update French translations") == "i18n_motivated"
        assert ic.classify_intent("i18n(fr): update") == "i18n_motivated"

    def test_l10n_prefix_matches(self):
        assert ic.classify_intent("l10n: fix French plurals") == "i18n_motivated"

    def test_translator_pushback_matches(self):
        assert ic.classify_intent("update source string per translator feedback") == "i18n_motivated"

    def test_i18n_wins_over_typo(self):
        # Both "i18n:" and "typo" present — i18n is the higher-priority
        # signal because it changes the review lens.
        assert ic.classify_intent("i18n: fix typo in French") == "i18n_motivated"

    # --- tone_shift ---

    def test_tone_shift_matches_tone(self):
        assert ic.classify_intent("soften tone in error message") == "tone_shift"

    def test_tone_shift_matches_voice(self):
        assert ic.classify_intent("adjust voice to match brand") == "tone_shift"

    def test_tone_shift_matches_friendlier(self):
        assert ic.classify_intent("make empty state friendlier") == "tone_shift"

    def test_tone_shift_matches_approachable(self):
        assert ic.classify_intent("make onboarding more approachable") == "tone_shift"

    # --- clarification ---

    def test_clarification_matches_clarify(self):
        assert ic.classify_intent("clarify copy on upgrade page") == "clarification"

    def test_clarification_matches_simplify(self):
        assert ic.classify_intent("simplify error explanation") == "clarification"

    def test_clarification_matches_reword(self):
        assert ic.classify_intent("reword confusing button label") == "clarification"

    def test_clarification_matches_disambiguate(self):
        assert ic.classify_intent("disambiguate account vs profile") == "clarification"

    # --- restructure ---

    def test_restructure_matches_rewrite(self):
        assert ic.classify_intent("rewrite the empty-state section") == "restructure"

    def test_restructure_matches_reorganize(self):
        assert ic.classify_intent("reorganize API docs into sections") == "restructure"

    def test_restructure_matches_consolidate(self):
        assert ic.classify_intent("consolidate duplicate docs") == "restructure"

    # --- unknown ---

    def test_unknown_falls_through(self):
        assert ic.classify_intent("add new feature") == "unknown"
        assert ic.classify_intent("refactor module") == "unknown"
        assert ic.classify_intent("bump version") == "unknown"
        assert ic.classify_intent("ci: update workflow") == "unknown"

    def test_empty_input(self):
        assert ic.classify_intent("") == "unknown"
        assert ic.classify_intent("   ") == "unknown"


# ═══════════════════════════════════════════════════════════════════════
# Intent → triage mapping
# ═══════════════════════════════════════════════════════════════════════


class TestIntentToTriage:
    def test_typo_fix_maps_to_correct(self):
        assert ic.suggested_triage_category("typo_fix") == "correct"

    def test_clarification_maps_to_missing_standard(self):
        assert ic.suggested_triage_category("clarification") == "missing_standard"

    def test_tone_shift_maps_to_missing_standard(self):
        assert ic.suggested_triage_category("tone_shift") == "missing_standard"

    def test_restructure_maps_to_context_gap(self):
        assert ic.suggested_triage_category("restructure") == "context_gap"

    def test_i18n_maps_to_trn_family(self):
        assert ic.suggested_triage_category("i18n_motivated") == "TRN"

    def test_unknown_maps_to_unknown(self):
        assert ic.suggested_triage_category("unknown") == "unknown"

    def test_every_category_has_a_mapping(self):
        for cat in ic.VALID_INTENT_CATEGORIES:
            assert ic.suggested_triage_category(cat) != ""


# ═══════════════════════════════════════════════════════════════════════
# Repo quality scorer
# ═══════════════════════════════════════════════════════════════════════


class TestScoreRepo:
    def test_all_signals_true_returns_max(self):
        repo = {
            "quality_signals": {
                "has_content_designer": True,
                "active_i18n": True,
                "content_design_blog": True,
            }
        }
        r = rq.score_repo(repo)
        assert r["score"] == 3
        assert r["max"] == 3
        assert set(r["signals_fired"]) == set(rq.QUALITY_SIGNALS)
        assert r["signals_missing"] == []

    def test_no_signals_block_returns_zero(self):
        r = rq.score_repo({})
        assert r["score"] == 0
        assert r["signals_fired"] == []
        assert set(r["signals_missing"]) == set(rq.QUALITY_SIGNALS)

    def test_partial_signals(self):
        repo = {
            "quality_signals": {
                "has_content_designer": True,
                "active_i18n": False,
                "content_design_blog": True,
            }
        }
        r = rq.score_repo(repo)
        assert r["score"] == 2
        assert "has_content_designer" in r["signals_fired"]
        assert "active_i18n" in r["signals_missing"]


class TestRankRepos:
    def test_ranks_by_score_desc(self):
        repos = [
            {"owner": "a", "name": "one", "quality_signals": {"has_content_designer": False, "active_i18n": False, "content_design_blog": False}},
            {"owner": "b", "name": "two", "quality_signals": {"has_content_designer": True, "active_i18n": True, "content_design_blog": True}},
            {"owner": "c", "name": "three", "quality_signals": {"has_content_designer": True, "active_i18n": False, "content_design_blog": False}},
        ]
        ranked = rq.rank_repos(repos)
        assert ranked[0][0]["owner"] == "b"  # score 3
        assert ranked[0][1] == 3
        assert ranked[-1][0]["owner"] == "a"  # score 0

    def test_ties_broken_by_owner_name(self):
        repos = [
            {"owner": "z", "name": "a", "quality_signals": {"has_content_designer": True, "active_i18n": False, "content_design_blog": False}},
            {"owner": "a", "name": "b", "quality_signals": {"has_content_designer": True, "active_i18n": False, "content_design_blog": False}},
        ]
        ranked = rq.rank_repos(repos)
        # Both score 1; owner "a" sorts first alphabetically.
        assert ranked[0][0]["owner"] == "a"


# ═══════════════════════════════════════════════════════════════════════
# Allow-list has quality signals per Session 18
# ═══════════════════════════════════════════════════════════════════════


class TestAllowListHasQualitySignals:
    def test_every_repo_has_quality_signals_block(self):
        import json
        path = EXT_DIR / "allow_list.json"
        with open(path) as f:
            data = json.load(f)
        for repo in data["repos"]:
            assert "quality_signals" in repo, f"{repo['owner']}/{repo['name']}"

    def test_signals_block_uses_known_keys(self):
        import json
        path = EXT_DIR / "allow_list.json"
        with open(path) as f:
            data = json.load(f)
        for repo in data["repos"]:
            for key in repo["quality_signals"]:
                assert key in rq.QUALITY_SIGNALS, (
                    f"{repo['owner']}/{repo['name']} has unknown signal key {key}"
                )
