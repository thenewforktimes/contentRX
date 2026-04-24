# Changelog

## 0.1.0 — 2026-04-24

First public release. BUILD_PLAN_v2 Session 18.

- Launches `contentrx-lsp` over stdio with the user's API key
  injected via the server's `CONTENTRX_API_KEY` env var.
- Autodetects `contentrx-lsp` on `$PATH`; falls back to
  `uvx contentrx-lsp` when `uv` is installed.
- Stores the API key in VS Code's SecretStorage (OS keychain).
- Status-bar item shows `{violations}/{review_recommended}` counts
  for the active editor.
- Commands: set / clear API key, restart the language server.
- Activates on `typescriptreact`, `javascriptreact`, `typescript`,
  `javascript` documents.
