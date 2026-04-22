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

### `evaluate_copy` — full review (counts against quota)

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

Counts against your monthly quota (Free: 25, Pro: 5,000, Team:
5,000 × seats).

### `classify_moment` — quick moment probe (no quota cost)

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

### `explain_violation` — rule rationale + examples (no quota cost)

Look up the full text + pass/fail examples for any standard ID. The
`violations[].standard_id` field of an `evaluate_copy` result is the
typical input here.

```
explain_violation(standard_id: str) -> {
  id, rule, correct, incorrect, rule_type, category_id, category_name,
  relevant_content_types, content_type_notes,
}
```

Public — works without an API key. Useful even before you have an
account, for spec browsing.

### `list_standards` — filterable rule catalog (no quota cost)

Browse the standards library. Optional moment filter narrows to rules
that "matter" for the moment (i.e. emphasized or relaxed; suppressed
rules are excluded).

```
list_standards(moment: str | None) -> {
  total: int,
  moment_filter: str | None,
  standards: [{id, rule, rule_type, relevant_content_types}],
}
```

Public — works without an API key.

## Resources

Three read-only resources the LLM can pull into context:

| URI | What |
|---|---|
| `contentrx://standards` | Markdown index of every standard in the library |
| `contentrx://standards/{id}` | A single standard — rule, examples, notes, content-type guidance |
| `contentrx://moments` | The 13 UI moments + each one's standards-weight adjustments |

Resources don't require an API key.

## Prompts

### `/review_ui_copy [focus?]`

Multi-step review workflow. Walks every UI string in a file or diff
through `classify_moment` → `evaluate_copy` (and `explain_violation`
where useful), then summarizes violations by severity with rule
citations.

```
/review_ui_copy                              # uses file/diff in context
/review_ui_copy src/app/dashboard/page.tsx   # focus a specific file
/review_ui_copy "Click here to learn more"   # focus a single string
```

Appears as a slash command in Claude desktop and Cursor.

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
