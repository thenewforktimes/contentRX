# mcp-server — Claude Code instructions

**Read this file first. Every session working in `mcp-server/`.**

## What this is

The PyPI-published `contentrx-mcp` package — an MCP (Model Context
Protocol) server that exposes ContentRX's content-design review tools
to MCP clients (Claude Code, Cursor, Claude desktop, …). Lives next to
the engine + backend app + CLI client in the same monorepo so the four
ship on one branch, but it is **not** coupled to the engine source: the
MCP server is a pure HTTP client over the public ContentRX API.

## Locked architectural decisions

- **Do not import from `content_checker`.** This package is a thin HTTP
  client, the same architectural rule as `cli-client/`. All engine
  logic stays server-side.
- **Auth is `CONTENTRX_API_KEY` env var.** No config files, no flags.
  Same convention as `cli-client/`.
- **HTTP client is `httpx.AsyncClient`.** The MCP SDK is async, so a
  sync client would force unnecessary thread-pool work. Stdlib `urllib`
  is not async-friendly enough to be worth it here, even though it kept
  `cli-client/` dep-free.
- **Tool descriptions are surface area.** Verb-first, under 120
  characters, written for the LLM that will read them — not for a
  human skimming the API. Bad descriptions make the LLM call the wrong
  tool or no tool at all.
- **Errors return as dicts with `error` + `kind`, never as raised
  exceptions.** MCP clients render structured errors inline; raised
  exceptions surface as stack traces, which is the failure mode the
  v2 Session 4 acceptance criteria call out.
- **`contentrx-mcp = contentrx_mcp.server:main`.** Module name uses
  underscore (Python convention); CLI command uses hyphen (CLI
  convention). The console script in `pyproject.toml` bridges them.

## What not to do

- Don't add tools that aren't on the v2 plan for the current release.
  v2 Session 4 = the two tools shipping in 0.1; v2 Session 5 adds
  `explain_violation` + `list_standards` + resources + the
  `review_ui_copy` prompt.
- Don't expose tool descriptions that say what the tool DOES rather
  than what it DOES FOR THE CALLER. "Returns violations with rule
  citations" is correct. "Sends a POST to /api/check" is wrong (that's
  implementation, not user value).
- Don't bypass `get_api_key()` validation. If the env var is missing
  or malformed, fail with the dashboard URL — never try unauthenticated
  requests.
- Don't log the raw API key. Not via `print`, not via `logger.debug`,
  not in `--verbose`-style flags. Treat it like a password.
- Don't import the MCP server from anywhere — it's an entry point, not
  a library.

## Testing

```bash
cd mcp-server
pip install -e ".[dev]"
pytest tests/
```

Tests mock `httpx.AsyncClient` — no network, no real API key needed.

To smoke-test against the live deployment:

```bash
export CONTENTRX_API_KEY=cx_...
contentrx-mcp     # speaks MCP over stdio; use the MCP inspector to drive it
```

To smoke-test against `npm run dev`:

```bash
export CONTENTRX_API_KEY=cx_...
export CONTENTRX_API_URL=http://localhost:3000
export CONTENTRX_INSECURE_HTTP=1
contentrx-mcp
```

## Release checklist

When pushing a new version to PyPI:

1. Bump `__version__` in `src/contentrx_mcp/__init__.py` AND `version`
   in `pyproject.toml` — they must match. Update the User-Agent in
   `client.py` (`_USER_AGENT`) too.
2. Update `README.md` if the tool surface changed.
3. `pytest tests/` green.
4. `python -m build` (produces `dist/*.whl` and `dist/*.tar.gz`).
5. Push a `mcp-v0.X.Y` tag — `.github/workflows/publish_mcp.yml`
   handles the PyPI upload via trusted publishing (no API token in
   the workflow itself).
6. Verify `pip install --upgrade contentrx-mcp` in a clean venv picks
   up the new version, and `contentrx-mcp --help` (or the MCP
   inspector) confirms the new tools are registered.

## Tool description style guide

The two tool descriptions shipped in 0.1 are the template for any
addition. Both:

1. Open with a verb that names what the tool does for the caller
   ("Check ...", "Classify ...").
2. Stay under 120 characters of description text (the line right
   under the function signature, before the `Args:` block).
3. Include enough context that the LLM can decide WHEN to call this
   tool versus another one ("before writing copy for a new component"
   tells the LLM that classify_moment is a planning step).
4. List the return shape in the docstring's body — not the tool
   description — so the LLM gets the surface in one read but the
   description stays scannable.
