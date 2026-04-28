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
[contentrx.io/dashboard](https://contentrx.io/dashboard)
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

## Prompts

### `/review_ui_copy [focus?]`

Multi-step review workflow. Walks every UI string in a file or diff
through `classify_moment` → `evaluate_copy`, then summarizes violations
by severity with suggested rewrites.

```
/review_ui_copy                              # uses file/diff in context
/review_ui_copy src/app/dashboard/page.tsx   # focus a specific file
/review_ui_copy "Click here to learn more"   # focus a single string
```

Appears as a slash command in Claude desktop and Cursor.

## Examples

Three concrete scenarios showing how this surface fits into an AI-
assisted coding workflow.

### 1. Catching a vague CTA before it ships

You ask Claude Code to add a button to a React component:

> **You:** Add a "Click here to view pricing" button to the hero section.

Claude Code calls `evaluate_copy` before writing the JSX:

```text
evaluate_copy(text="Click here to view pricing")

→ verdict: "violation"
  violations: [
    {
      issue: "Vague CTA — 'Click here' doesn't name the destination",
      suggestion: "Lead with the action verb + object: 'View pricing'",
      severity: "block",
      confidence: 0.91
    }
  ]
```

Claude writes `<Button>View pricing</Button>` instead. Review that
would have happened in a PR now happens before the first commit.

### 2. Reviewing a whole component file via `/review_ui_copy`

In Claude desktop with a file open in context:

```text
/review_ui_copy src/app/dashboard/subscription-panel.tsx
```

The prompt walks every UI string in the file: `classify_moment` →
`evaluate_copy`. Returns a structured summary grouped by severity with
suggested rewrites. Typical output for a 200-line dashboard component
surfaces 3–8 violations most human reviewers miss on skim.

### 3. Planning copy for a destructive-action dialog

You ask Claude for a confirmation dialog before shipping:

> **You:** Write the copy for a "delete API key" confirmation.

Claude calls `classify_moment` first so the content-type signal is
locked in before drafting:

```text
classify_moment(text="Are you sure you want to delete this key?")
→ content_type: "confirmation"
  moment: "destructive_action"
```

Then `evaluate_copy` on candidate phrasings. The `destructive_action`
moment weighs `CLR-02` (consequence clarity) and `TRS-01` (reversibility)
more heavily — if the candidate doesn't mention "cannot be undone,"
ContentRX flags it and Claude revises before you see the draft.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `CONTENTRX_API_KEY` | required | Your `cx_...` token from the dashboard |
| `CONTENTRX_API_URL` | `https://contentrx.io` | Override for local dev or self-hosting |
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

### Error kinds

| `kind` | What it means | Recommended action |
|---|---|---|
| `AuthError` | `CONTENTRX_API_KEY` is missing or malformed | Stop. Prompt the user to generate a key at https://contentrx.io/dashboard and set the env var. |
| `AuthFailedError` | The API rejected the `cx_...` token (revoked, rotated, or typo) | Stop. Prompt the user to re-mint their key at the dashboard. |
| `QuotaExhaustedError` | The user's monthly quota is at zero | Stop. Surface the included `upgrade_url` to the user. Don't retry. |
| `RateLimitError` | Per-user sliding-window rate limit hit | Wait `retry_after_seconds`, then retry once. If the second attempt also 429s, surface the error and let the user decide. |
| `ContentRXError` | Generic upstream failure (5xx, network blip, unexpected response shape) | Retry once with a short backoff (1–3s). If still failing, surface the error. |

MCP clients can branch on `kind` to retry, prompt the user to upgrade,
or stop. The `error` string is human-readable but not machine-stable —
always key off `kind` for control flow.

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
