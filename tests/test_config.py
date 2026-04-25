"""Tests for engine-side feature flags."""

from __future__ import annotations

import pytest

from content_checker.config import is_public_taxonomy_enabled


class TestPublicTaxonomyFlag:
    """The flag defaults to False and only flips on explicit truthy values."""

    def test_unset_defaults_to_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("PUBLIC_TAXONOMY", raising=False)
        assert is_public_taxonomy_enabled() is False

    def test_empty_string_is_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PUBLIC_TAXONOMY", "")
        assert is_public_taxonomy_enabled() is False

    def test_whitespace_only_is_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PUBLIC_TAXONOMY", "   ")
        assert is_public_taxonomy_enabled() is False

    @pytest.mark.parametrize(
        "value",
        ["true", "True", "TRUE", "1", "yes", "YES", "on", "ON"],
    )
    def test_truthy_values_enable_the_flag(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        monkeypatch.setenv("PUBLIC_TAXONOMY", value)
        assert is_public_taxonomy_enabled() is True

    def test_truthy_values_tolerate_surrounding_whitespace(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PUBLIC_TAXONOMY", "  true  ")
        assert is_public_taxonomy_enabled() is True

    @pytest.mark.parametrize(
        "value",
        ["false", "False", "0", "no", "off", "maybe", "TRUE_ISH", "y", "t"],
    )
    def test_falsy_and_unrecognized_values_are_false(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        # Unrecognized values default to False to fail closed:
        # if someone sets PUBLIC_TAXONOMY="probably" thinking it's enabled,
        # the substrate stays private rather than leaking.
        monkeypatch.setenv("PUBLIC_TAXONOMY", value)
        assert is_public_taxonomy_enabled() is False

    def test_reads_at_call_time_not_import_time(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Important for tests: flipping the env var between calls must
        # change the result without re-importing the module.
        monkeypatch.setenv("PUBLIC_TAXONOMY", "false")
        assert is_public_taxonomy_enabled() is False

        monkeypatch.setenv("PUBLIC_TAXONOMY", "true")
        assert is_public_taxonomy_enabled() is True

        monkeypatch.setenv("PUBLIC_TAXONOMY", "false")
        assert is_public_taxonomy_enabled() is False
