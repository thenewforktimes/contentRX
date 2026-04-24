"""ContentRX Language Server Protocol implementation.

Published to PyPI as `contentrx-lsp`. Launched by editor extensions
over stdio via `uvx contentrx-lsp` (or directly once installed).

Architecture mirrors the MCP server (`contentrx-mcp`) and the CLI
client (`contentrx-cli`): this package is a thin client over the
public ContentRX API. All engine logic stays server-side — the LSP
does not import from `content_checker`.
"""

__version__ = "0.1.0"
