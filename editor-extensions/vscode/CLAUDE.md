# editor-extensions/vscode — Claude Code instructions

**Read this file first. Every session working in `editor-extensions/vscode/`.**

## What this is

The VS Code + Cursor extension that launches `contentrx-lsp` over
stdio and exposes the language server's diagnostics + code actions to
the editor. Published to the VS Code Marketplace as `ContentRX`.

## Locked architectural decisions

- **Zero ContentRX logic lives here.** This is glue. All parsing,
  diagnostics, and HTTP live in the LSP server. If you find yourself
  reaching for the content-rx engine in this codebase, stop.
- **Stored API key = secret storage only.** Use VS Code's
  `ExtensionContext.secrets` — never global settings, never a file.
  Clearing the key requires the `contentrx.clearApiKey` command.
- **`uvx` fallback is the happy path for first-run.** The autodetect
  order is: explicit `contentrx.serverPath` setting → binary on PATH
  → `uvx contentrx-lsp`. The last one means the extension is
  installable with zero prior setup on a machine with `uv`.
- **vscode-languageclient v9.x.** v10 is in alpha and requires a
  newer VS Code engine than most users have.
- **Activation on JSX/TSX/JS/TS files only.** Don't broaden without
  a plan — parsing random non-JS files is noise.

## What not to do

- Don't add UI that isn't in the Session 18 spec. Status bar + three
  commands. No dashboards, no panels, no notifications beyond the
  "API key needed" first-run prompt.
- Don't log the raw API key. Not in `console.log`, not in the output
  channel, not in trace output.
- Don't bypass VS Code's secret storage for "convenience." If the
  user wants to store the key in an env var, the extension already
  respects `CONTENTRX_API_KEY` from the process env.
- Don't add a webview. The LSP's native diagnostics + code actions
  are the UI surface.

## Build + publish

```bash
cd editor-extensions/vscode
npm install
npm run compile
```

To produce a `.vsix`:

```bash
npm install -g @vscode/vsce
npm run package
```

The `.vsix` is what you upload to the Marketplace or sideload into
Cursor. Publishing happens via `vsce publish` with a publisher PAT.

## Testing

The extension has no automated tests today — VS Code extension tests
require a headless VS Code runner which is heavyweight for a glue
layer. Exercise smoke paths manually:

1. Install the `.vsix` into a clean VS Code.
2. Open a `.tsx` file with `<Button>Click here</Button>`.
3. Confirm: status bar shows `ContentRX`, diagnostic appears, code
   actions list three items, "Rewrite" command applies an edit.
4. `contentrx.clearApiKey` command removes the stored key and stops
   the server.

If we add tests later, use `@vscode/test-electron` — it spins up a
full VS Code in headless mode and exercises extension API surfaces
end-to-end.
