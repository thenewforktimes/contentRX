"""Standards library loader with module-level caching.

Reads and parses standards_library.json once per process lifetime.
Subsequent calls return the cached copy. Custom paths bypass the cache
to support testing and alternative library files.

Performance impact:
    Before: check_batch(50 strings) → 51 file reads + JSON parses
    After:  check_batch(50 strings) → 1 file read + JSON parse (first call only)

The cache stores a deep copy reference. Callers that need to mutate the
data (e.g., filter_standards) should copy it themselves — filter.py
already does this via copy.deepcopy().

Cache invalidation:
    - _reset_cache() for testing
    - Custom path= argument bypasses cache entirely
    - Process restart clears the cache naturally
    - No file-watcher or TTL needed: the standards library changes only
      when a developer edits it and restarts the process
"""

from __future__ import annotations

import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Module-level cache
# ---------------------------------------------------------------------------

_cache: dict | None = None
_cache_path: Path | None = None


def load_standards(path: str | Path | None = None) -> dict:
    """Load the standards library from JSON.

    Args:
        path: Optional path to a custom standards library file.
            If None, uses the default path relative to this module:
            standards_library.json in the same directory.

    Returns:
        The parsed standards library as a dict.

    Raises:
        FileNotFoundError: If the standards file doesn't exist.
        json.JSONDecodeError: If the file isn't valid JSON.
    """
    global _cache, _cache_path

    # Custom paths always bypass the cache — test fixtures and
    # alternative libraries should never pollute the default cache
    if path is not None:
        resolved = Path(path).resolve()
        with open(resolved) as f:
            return json.load(f)

    # Default path: return cached copy if available
    if _cache is not None:
        return _cache

    # First call with default path: load, cache, return
    default_path = Path(__file__).parent / "standards_library.json"

    if not default_path.exists():
        raise FileNotFoundError(
            f"Standards library not found at {default_path}. "
            f"Expected standards_library.json in {default_path.parent}."
        )

    with open(default_path) as f:
        data = json.load(f)

    _cache = data
    _cache_path = default_path

    return _cache


def get_cache_info() -> dict:
    """Return cache status for diagnostics.

    Returns:
        Dict with 'cached' (bool), 'path' (str or None),
        and 'standard_count' (int or None).
    """
    if _cache is None:
        return {"cached": False, "path": None, "standard_count": None}

    count = sum(
        len(cat.get("standards", []))
        for cat in _cache.get("categories", [])
    )

    return {
        "cached": True,
        "path": str(_cache_path) if _cache_path else None,
        "standard_count": count,
    }


# ---------------------------------------------------------------------------
# Cache management (testing only)
# ---------------------------------------------------------------------------

def _reset_cache():
    """Clear the cached standards library. For testing only.

    Call this in test fixtures when you need to ensure a fresh load,
    e.g., after patching the JSON file on disk.
    """
    global _cache, _cache_path
    _cache = None
    _cache_path = None
