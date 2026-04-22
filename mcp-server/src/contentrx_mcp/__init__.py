"""ContentRX MCP server — content-design review for any MCP client.

Single source of truth for the package version. `pyproject.toml`
mirrors this string; bump them together at release time per the release
checklist in CLAUDE.md.
"""

__version__ = "0.3.0"

__all__ = ["__version__"]
