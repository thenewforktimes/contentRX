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
# Module-level caches
# ---------------------------------------------------------------------------
#
# Each substrate JSON file has its own cache. All three live in the
# gitignored private/ subdir per ADR 2026-04-25.

_cache: dict | None = None
_cache_path: Path | None = None

_moments_cache: dict | None = None
_ui_specific_cache: frozenset[str] | None = None


def _missing_substrate_error(path: Path) -> FileNotFoundError:
    return FileNotFoundError(
        f"Substrate file not found at {path}. "
        "Substrate JSON lives in the gitignored private/ subdir per "
        "ADR 2026-04-25. Local dev: clone the private substrate repo "
        "into src/content_checker/standards/private/ (or run "
        "`npm run fetch:substrate` with SUBSTRATE_TOKEN set). Public "
        "CI: tests that need the substrate skip automatically when "
        "this path is missing."
    )


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
    default_path = Path(__file__).parent / "private" / "standards_library.json"

    if not default_path.exists():
        raise _missing_substrate_error(default_path)

    with open(default_path) as f:
        data = json.load(f)

    _validate_schema(data, default_path)
    _cache = data
    _cache_path = default_path

    return _cache


def load_moments_taxonomy() -> dict:
    """Load the moments taxonomy JSON from the private substrate.

    Cached per process. Source of truth for moment IDs, descriptions,
    situation_property mappings, and per-standard moment weights.

    Raises:
        FileNotFoundError: if the substrate isn't present.
        json.JSONDecodeError: if the file is malformed.
    """
    global _moments_cache

    if _moments_cache is not None:
        return _moments_cache

    default_path = Path(__file__).parent / "private" / "moments_taxonomy.json"

    if not default_path.exists():
        raise _missing_substrate_error(default_path)

    with open(default_path) as f:
        data = json.load(f)

    if "moments" not in data or not isinstance(data["moments"], list):
        raise ValueError(f"{default_path}: missing or invalid `moments` array")

    _moments_cache = data
    return _moments_cache


def load_ui_specific_standards() -> frozenset[str]:
    """Load the UI-specific standards frozenset from the private substrate.

    These are the standard IDs suppressed in 'general' audience mode
    (presentations, marketing, internal docs) but enforced in
    'product_ui' mode. Each suppression is justified by triage
    evidence; the rationale strings live alongside the IDs in the
    JSON for traceability.

    Cached per process.

    Raises:
        FileNotFoundError: if the substrate isn't present.
    """
    global _ui_specific_cache

    if _ui_specific_cache is not None:
        return _ui_specific_cache

    default_path = Path(__file__).parent / "private" / "ui_specific_standards.json"

    if not default_path.exists():
        raise _missing_substrate_error(default_path)

    with open(default_path) as f:
        data = json.load(f)

    if "standards" not in data or not isinstance(data["standards"], list):
        raise ValueError(
            f"{default_path}: missing or invalid `standards` array"
        )

    ids = frozenset(entry["id"] for entry in data["standards"] if "id" in entry)
    _ui_specific_cache = ids
    return _ui_specific_cache


# Required keys per node. Validated at load time so a malformed library
# fails the process startup with a clear message instead of corrupting a
# downstream prompt or KeyErroring deep in the pipeline.
_REQUIRED_TOP_LEVEL = {"version", "categories"}
_REQUIRED_CATEGORY = {"id", "name", "standards"}
_REQUIRED_STANDARD = {"id", "rule", "rule_type"}


def _validate_schema(data: dict, source: Path) -> None:
    missing = _REQUIRED_TOP_LEVEL - set(data)
    if missing:
        raise ValueError(f"{source}: missing top-level keys {sorted(missing)}")
    if not isinstance(data["categories"], list):
        raise ValueError(f"{source}: 'categories' must be a list")

    seen_ids: set[str] = set()
    for ci, cat in enumerate(data["categories"]):
        if not isinstance(cat, dict):
            raise ValueError(f"{source}: categories[{ci}] is not an object")
        cat_missing = _REQUIRED_CATEGORY - set(cat)
        if cat_missing:
            raise ValueError(
                f"{source}: categories[{ci}] missing keys {sorted(cat_missing)}",
            )
        if not isinstance(cat["standards"], list):
            raise ValueError(
                f"{source}: categories[{ci}].standards must be a list",
            )
        for si, std in enumerate(cat["standards"]):
            if not isinstance(std, dict):
                raise ValueError(
                    f"{source}: categories[{ci}].standards[{si}] is not an object",
                )
            std_missing = _REQUIRED_STANDARD - set(std)
            if std_missing:
                raise ValueError(
                    f"{source}: standard {std.get('id', '?')} missing "
                    f"{sorted(std_missing)}",
                )
            sid = std["id"]
            if sid in seen_ids:
                raise ValueError(f"{source}: duplicate standard id {sid!r}")
            seen_ids.add(sid)


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
    """Clear all substrate caches. For testing only.

    Call this in test fixtures when you need to ensure a fresh load,
    e.g., after patching the JSON files on disk.
    """
    global _cache, _cache_path, _moments_cache, _ui_specific_cache
    _cache = None
    _cache_path = None
    _moments_cache = None
    _ui_specific_cache = None
