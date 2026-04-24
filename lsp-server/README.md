# contentrx-lsp

Inline content-design diagnostics in any LSP-capable editor — VS Code,
Cursor, Zed, Neovim, JetBrains IDEs.

ContentRX's Language Server reads JSX/TSX source, pulls out UI copy
(JSX text content and stringy JSX attributes), and surfaces violations
of the ContentRX content model directly in the editor's problems panel
as you type.

## Install

```bash
uvx contentrx-lsp       # one-shot, no persistent install
pipx install contentrx-lsp
pip install contentrx-lsp
```

Most editors don't need you to install this by hand — use the
[ContentRX VS Code / Cursor extension](https://marketplace.visualstudio.com/items?itemName=ContentRX.contentrx)
and it will launch the server on first activation.

## Configure

Set `CONTENTRX_API_KEY` in the environment the editor runs with.
Generate a key at [contentrx.io/dashboard](https://contentrx.io/dashboard).

```bash
export CONTENTRX_API_KEY=cx_...
```

For local development against `npm run dev`:

```bash
export CONTENTRX_API_URL=http://localhost:3000
export CONTENTRX_INSECURE_HTTP=1
```

## What it emits

For every extracted string, the server calls `/api/check` and emits
one LSP diagnostic per violation:

- **`violation`** verdict → severity `Warning` (yellow squiggle)
- **`review_recommended`** verdict → severity `Information` (blue squiggle)
- **`pass`** verdict → no diagnostic

Each diagnostic carries the standard ID as the diagnostic `code` and
points at the full rationale on `docs.contentrx.io`.

## How it works

1. `initialize` handshake advertises incremental text sync and UTF-16
   position encoding — the LSP spec's default, matches every editor.
2. `didOpen` / `didChange` update the in-memory document state. Lint
   jobs debounce for 400ms so rapid typing doesn't thrash the API.
3. A per-document token bucket caps API calls at 2 per second.
4. Tree-sitter parses the TSX source; string extraction is scoped to
   JSX text children and allow-listed copy attributes (`alt`,
   `aria-label`, `placeholder`, `title`, `tooltip`, `label`, …).
5. `/api/check` runs server-side — the LSP is a thin HTTP client, no
   engine imports. Results map to LSP diagnostics via
   `src/contentrx_lsp/diagnostics.py`.

## Architecture

Three surfaces talk to the same `/api/check`:

- **MCP server** (`contentrx-mcp`) — Claude Code, Cursor chat, Claude desktop
- **LSP server** (`contentrx-lsp`) — inline diagnostics
- **CLI** (`contentrx-cli`) — terminal + CI

One source of truth for verdicts; no per-surface drift.

## Try it

With an API key set, point any LSP client at `contentrx-lsp` and open
a TSX file. The reference test case:

```tsx
export function SignInButton() {
  return <button>Click here</button>;
}
```

Expected diagnostic: `ACT-01` (generic CTA verb) on the `Click here`
text range.
