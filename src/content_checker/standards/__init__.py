"""Standards library loading and management.

The substrate JSON files (`standards_library.json`, `moments_taxonomy.json`)
live in the gitignored `private/` subdirectory per ADR 2026-04-25. Local
dev populates that directory from the private substrate repo (configured
as a git submodule); public CI runs without it.

Path constants are exposed here so tools and tests can locate substrate
without duplicating the path string. If the substrate location ever
changes again, all consumers update via this module.
"""

from pathlib import Path

from content_checker.standards.loader import load_standards

STANDARDS_DIR = Path(__file__).parent
PRIVATE_SUBSTRATE_DIR = STANDARDS_DIR / "private"
STANDARDS_LIBRARY_PATH = PRIVATE_SUBSTRATE_DIR / "standards_library.json"
MOMENTS_TAXONOMY_PATH = PRIVATE_SUBSTRATE_DIR / "moments_taxonomy.json"

__all__ = [
    "load_standards",
    "STANDARDS_DIR",
    "PRIVATE_SUBSTRATE_DIR",
    "STANDARDS_LIBRARY_PATH",
    "MOMENTS_TAXONOMY_PATH",
]
