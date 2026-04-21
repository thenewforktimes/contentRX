"""Tests for the standards loader with caching (loader.py).

Covers:
    1. Basic loading — file exists, correct structure
    2. Caching — second call returns same object, no re-read
    3. Custom path bypass — custom paths never pollute cache
    4. Cache reset — _reset_cache() clears for test isolation
    5. Diagnostics — get_cache_info() returns correct status
    6. Error handling — missing file, invalid JSON
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from content_checker.standards.loader import (
    load_standards,
    get_cache_info,
    _reset_cache,
)


@pytest.fixture(autouse=True)
def clean_cache():
    """Reset the cache before and after every test."""
    _reset_cache()
    yield
    _reset_cache()


# ═══════════════════════════════════════════════════════════════════════════
# Basic loading
# ═══════════════════════════════════════════════════════════════════════════


class TestBasicLoading:
    """Standard load_standards() behavior."""

    def test_returns_dict(self):
        result = load_standards()
        assert isinstance(result, dict)

    def test_has_categories(self):
        result = load_standards()
        assert "categories" in result

    def test_has_47_standards(self):
        result = load_standards()
        count = sum(
            len(cat.get("standards", []))
            for cat in result.get("categories", [])
        )
        assert count == 47

    def test_has_9_categories(self):
        result = load_standards()
        assert len(result["categories"]) == 9

    def test_has_content_types(self):
        result = load_standards()
        assert "content_types" in result
        assert len(result["content_types"]) == 8


# ═══════════════════════════════════════════════════════════════════════════
# Caching
# ═══════════════════════════════════════════════════════════════════════════


class TestCaching:
    """Module-level cache eliminates redundant disk reads."""

    def test_second_call_returns_same_object(self):
        """Cache hit: same object identity, not just equality."""
        first = load_standards()
        second = load_standards()
        assert first is second

    def test_cache_info_before_load(self):
        info = get_cache_info()
        assert info["cached"] is False
        assert info["path"] is None
        assert info["standard_count"] is None

    def test_cache_info_after_load(self):
        load_standards()
        info = get_cache_info()
        assert info["cached"] is True
        assert info["path"] is not None
        assert info["standard_count"] == 47

    def test_reset_clears_cache(self):
        load_standards()
        assert get_cache_info()["cached"] is True
        _reset_cache()
        assert get_cache_info()["cached"] is False


# ═══════════════════════════════════════════════════════════════════════════
# Custom path bypass
# ═══════════════════════════════════════════════════════════════════════════


class TestCustomPath:
    """Custom path= argument bypasses and never pollutes the cache."""

    def test_custom_path_loads_from_file(self):
        """Custom path should read from the specified file."""
        data = {"categories": [{"name": "test", "standards": []}]}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(data, f)
            tmp_path = f.name

        result = load_standards(path=tmp_path)
        assert result == data

        # Clean up
        Path(tmp_path).unlink()

    def test_custom_path_does_not_populate_cache(self):
        """Loading from custom path should leave cache empty."""
        data = {"categories": []}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(data, f)
            tmp_path = f.name

        load_standards(path=tmp_path)
        assert get_cache_info()["cached"] is False

        Path(tmp_path).unlink()

    def test_custom_path_does_not_evict_cache(self):
        """Loading from custom path should not clear an existing cache."""
        load_standards()  # populate cache
        assert get_cache_info()["cached"] is True

        data = {"categories": []}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(data, f)
            tmp_path = f.name

        custom_result = load_standards(path=tmp_path)
        assert custom_result == data

        # Cache should still hold the original data
        cached = load_standards()
        assert len(cached["categories"]) == 9

        Path(tmp_path).unlink()


# ═══════════════════════════════════════════════════════════════════════════
# Error handling
# ═══════════════════════════════════════════════════════════════════════════


class TestErrorHandling:
    """Edge cases and error paths."""

    def test_missing_custom_path_raises(self):
        with pytest.raises(FileNotFoundError):
            load_standards(path="/nonexistent/path/standards.json")

    def test_invalid_json_raises(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            f.write("not valid json {{{")
            tmp_path = f.name

        with pytest.raises(json.JSONDecodeError):
            load_standards(path=tmp_path)

        Path(tmp_path).unlink()
