# contentrx-mcp

ContentRX as an MCP server — content-design review for Claude Code,
Cursor, Claude desktop, and any other MCP client.

This is the surface that turns ContentRX from "a thing designers run
on Figma frames" into "a thing your AI agent consults before writing
a button label." It speaks
[Model Context Protocol](https://modelcontextprotocol.io) over stdio
and exposes two tools (this release) backed by the public ContentRX
API.

## Install

```bash
# One-line install + run via uv
uvx contentrx-mcp

# Or install in a project venv
pip install contentrx-mcp
contentrx-mcp
```

The server speaks MCP over stdio; you don't run it standalone — your
MCP client launches it.

## Configure your MCP client

You need a ContentRX API key (`cx_...`). Generate one at
[content-rx.vercel.app/dashboard](https://content-rx.vercel.app/dashboard)
— it's shown once at mint time, so save it before closing the page.

### Claude desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on Linux/Windows:

```json
{
  "mcpServers": {
    "contentrx": {
      "command": "uvx",
      "args": ["contentrx-mcp"],
      "env": {
        "CONTENTRX_API_KEY": "cx_your_key_here"
      }
    }
  }
}
```

Restart Claude desktop. The two tools appear in the tools picker.

### Claude Code

```bash
claude mcp add contentrx -- uvx contentrx-mcp
# Then set the env var in your shell or in the project's mcp config:
export CONTENTRX_API_KEY=cx_your_key_here
```

### Cursor

Cursor's MCP config (Settings → MCP) takes the same shape as Claude
desktop's. Use the same `command` / `args` / `env` block.

## Tools

### `evaluate_copy`

Check UI copy against the 47-standard content-design library.

```
evaluate_copy(
  text: str,                      # the string to check
  moment_hint: str | None,        # optional: "error_recovery", "onboarding", etc.
  context: str | None,            # optional free-text context (reserved)
) -> {
  overall_verdict: "pass" | "fail" | "error",
  content_type: str,              # e.g. "error_message", "button_cta"
  moment: str,                    # e.g. "error_recovery"
  violations: [{standard_id, issue, suggestion, severity, ...}],
  passes: [{standard_id, rule}],
  summary: str | None,
}
```

This counts against your monthly quota (Free: 25, Pro: 5,000, Team:
5,000 × seats).

### `classify_moment`

Classify what UI moment a string represents — without running the
full evaluation. Useful for planning copy before you write it.

```
classify_moment(text: str) -> {
  content_type: str,              # e.g. "confirmation"
  moment: str,                    # e.g. "completing_task"
}
```

Free of quota. Rate-limited at 60/min per user (same bucket as
`evaluate_copy`).

## A `/review_ui_copy` prompt is coming in v2 Session 5

The 0.1 release ships only the two tools above. Session 5 (the next
release) adds:
- `explain_violation(standard_id)` — the rationale + examples for any
  rule the evaluator cited
- `list_standards(moment?)` — browseable rule catalog
- `contentrx://standards/*` resources
- A `review_ui_copy` prompt that wraps a full file or diff in a
  multi-step review workflow

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `CONTENTRX_API_KEY` | required | Your `cx_...` token from the dashboard |
| `CONTENTRX_API_URL` | `https://content-rx.vercel.app` | Override for local dev or self-hosting |
| `CONTENTRX_INSECURE_HTTP` | unset | Set to `1` to allow `http://` for local dev — refuses otherwise so a typo can't leak the token |

## Errors

The server returns structured errors instead of stack traces. Every
tool result is either a normal payload or:

```json
{
  "error": "Rate limit hit. Try again in 30s.",
  "kind": "RateLimitError",
  "retry_after_seconds": 30
}
```

`kind` values: `AuthError`, `AuthFailedError`, `QuotaExhaustedError`,
`RateLimitError`, `ContentRXError`. MCP clients can branch on `kind`
to retry, prompt the user to upgrade, or stop.

## Development

```bash
cd mcp-server
pip install -e ".[dev]"
pytest tests/

# Local dev against npm run dev:
export CONTENTRX_API_URL=http://localhost:3000
export CONTENTRX_INSECURE_HTTP=1
export CONTENTRX_API_KEY=cx_...     # mint via npm run dev dashboard
contentrx-mcp                        # speaks MCP over stdio
```

The MCP CLI from `mcp[cli]` is useful for poking the server without
a real client:

```bash
mcp dev contentrx-mcp                # opens the inspector UI
```

## Release checklist

See `mcp-server/CLAUDE.md` for the version-bump + PyPI publish flow.

## License

MIT — same as the ContentRX project.
