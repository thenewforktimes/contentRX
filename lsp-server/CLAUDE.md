# lsp-server — Claude Code instructions

**Read this file first. Every session working in `lsp-server/`.**

## What this is

The PyPI-published `contentrx-lsp` package — a Language Server
Protocol server that emits inline diagnostics for UI copy violations
in JSX/TSX files. Launched by editor extensions (VS Code, Cursor,
Zed, Neovim) over stdio via `uvx contentrx-lsp`.

Lives next to the engine + backend app + CLI client + MCP server in
the same monorepo so the five ship on one branch, but it is **not**
coupled to the engine source: the LSP server is a pure HTTP client
over the public ContentRX API, same architectural rule as
`mcp-server/` and `cli-client/`.

## Locked architectural decisions

- **Do not import from `content_checker`.** Engine logic stays
  server-side. Every violation traverses the network via `/api/check`.
- **Auth is `CONTENTRX_API_KEY` env var.** No config files, no flags.
  Same convention as the MCP server and CLI.
- **pygls 2.x is the LSP framework.** `from pygls.lsp.server import
  LanguageServer`. (1.x put it at `pygls.server.LanguageServer`.)
- **tree-sitter-typescript handles JSX/TSX parsing.** Always parse as
  TSX — it's a superset of plain TS. No separate grammar for `.ts`.
- **Extraction scope is JSX text + allow-listed copy attributes.**
  Random `"..."` string literals anywhere in source are not extracted.
  That would be noisy and most of those aren't UI copy. The allow-list
  lives in `parser._COPY_ATTRS`.
- **Per-document rate limit is 2 req/s via token bucket.** Tied to the
  /api/check rate limit budget.
- **Debounce is 400ms.** Empirically keeps up with typing without
  spamming the API. Tune in `server.DEBOUNCE_SECONDS` if telemetry
  shows we need finer control.
- **Position encoding is UTF-16.** LSP spec default. Our
  `_byte_to_line_char` converts from UTF-8 byte offsets correctly for
  multi-byte characters and surrogate pairs.

## What not to do

- Don't add new tool-surface features without a plan entry. The LSP
  scope is: diagnostics (Session 16), code actions + suggest-fix
  (Session 17), then editor extensions (Session 18). Stay inside that.
- Don't bypass `get_api_key()`. Missing key → `window/showMessage`
  warning, never try unauthenticated requests.
- Don't log the raw API key. Not via `print`, not via logging, not in
  `--verbose`-style flags. Treat it like a password.
- Don't emit diagnostics synchronously on `didChange`. The debounce +
  token bucket exist for good reason.
- Don't raise out of feature handlers — the editor will show a stack
  trace or mark the server as crashed. Convert errors into
  `window/showMessage` calls.

## Testing

```bash
cd lsp-server
pip install -e ".[dev]"
pytest tests/
```

Tests are fully offline — tree-sitter parses real source, the client
is exercised via mocks, pygls is loaded to register handlers but no
stdio transport is opened.

Smoke-test against live API:

```bash
export CONTENTRX_API_KEY=cx_...
contentrx-lsp   # speaks LSP over stdio; drive via VS Code extension or CLI MCP inspector analogue
```

## Release checklist

When pushing a new version to PyPI:

1. Bump `__version__` in `src/contentrx_lsp/__init__.py` AND `version`
   in `pyproject.toml` — they must match.
2. Update `README.md` if capabilities changed.
3. `pytest tests/` green.
4. `python -m build` (produces `dist/*.whl` and `dist/*.tar.gz`).
5. Push an `lsp-v0.X.Y` tag — the publish workflow handles PyPI upload.
6. Verify `pip install --upgrade contentrx-lsp` in a clean venv picks
   up the new version, and `contentrx-lsp --help` / the MCP inspector
   analogue confirms the server starts.
