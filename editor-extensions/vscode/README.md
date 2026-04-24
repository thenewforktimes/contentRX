# ContentRX for VS Code and Cursor

Inline content-design diagnostics as you type — staff-level UX-writing
review on every string in your JSX / TSX / JS / TS.

## Install

**VS Code Marketplace:** [ContentRX](https://marketplace.visualstudio.com/items?itemName=ContentRX.contentrx)

**Cursor:** Cursor runs VS Code extensions natively — install from the
Cursor extensions panel or sideload the `.vsix`. Same extension,
same behaviour.

The extension talks to [`contentrx-lsp`](https://pypi.org/project/contentrx-lsp/)
over stdio. On first activation, it will either:

- Use `contentrx-lsp` from your `$PATH` (if you ran `pipx install
  contentrx-lsp` or `uv tool install contentrx-lsp`), or
- Fall back to `uvx contentrx-lsp` — downloads and runs the server on
  demand.

You don't need to install the server separately unless `uv` isn't on
your system.

## First run

1. Generate an API key at
   [contentrx.io/dashboard](https://contentrx.io/dashboard).
2. The extension will prompt for it on first activation. It's stored
   via VS Code's [SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
   (OS keychain on macOS / Windows, libsecret on Linux).
3. Open a `.tsx` file. Diagnostics appear in the Problems panel and
   inline with yellow squiggles.

## Commands

| Command | What it does |
|---|---|
| `ContentRX: Set API key` | Re-prompts for a key and restarts the server |
| `ContentRX: Clear stored API key` | Removes the key from secret storage |
| `ContentRX: Restart language server` | Restart the `contentrx-lsp` process |

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `contentrx.serverPath` | `""` | Absolute path to `contentrx-lsp`. Blank → autodetect. |
| `contentrx.apiUrl` | `""` | Override the API base URL (local dev against `npm run dev`). |
| `contentrx.trace.server` | `"off"` | Log LSP traffic in the output channel — `"off"`, `"messages"`, or `"verbose"`. |

## What gets linted

JSX / TSX text children and a set of known-copy attributes:

- `alt`, `aria-label`, `aria-description`, `aria-placeholder`
- `label`, `placeholder`, `title`, `tooltip`, `description`

Random string literals in source code are NOT linted — false-positive
risk is too high. If you need to lint a specific string, paste it
into the ContentRX MCP tool or CLI.

## Code actions

On every ContentRX diagnostic:

- **Rewrite to clear the standard** — calls `/api/suggest-fix` and
  applies the rewrite in place.
- **Show standard rationale** — opens the standard's page on
  docs.contentrx.io.
- **Mark as false positive** — records the override, hides the
  diagnostic.

## Troubleshooting

**"No API key configured — ContentRX diagnostics are off."**
Run `ContentRX: Set API key` from the command palette.

**"couldn't find the contentrx-lsp binary"** — install it with
`pipx install contentrx-lsp` or `uv tool install contentrx-lsp`, or
set `contentrx.serverPath` to an explicit location.

**Diagnostics don't update as I type.** Check `contentrx.trace.server`
in the output channel to see the LSP traffic. A debounce of 400ms is
built in — edits faster than that coalesce into one lint.

## Support

- Issues: https://github.com/thenewforktimes/contentRX/issues
- Docs: https://docs.contentrx.io
