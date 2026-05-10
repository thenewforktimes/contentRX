# Bluesky thread draft

Bluesky's character cap is 300, slightly looser than X. The audience
reads in less algorithmic order; lead with substance over hook.

Five posts.

---

## 1/ The post

Launching ContentRX in public beta today.

A content-design pipeline (not an LLM with a prompt) that wraps the
model in the context it needs to render a real verdict on the
strings your team ships. UI moment, content-design standards, team
overrides, drift over time.

contentrx.io

## 2/ Six surfaces

Same engine, six places:

- Dashboard paste mode (paste a draft, get the digest)
- MCP for Claude Code + Cursor
- LSP diagnostics in any LSP editor
- CLI
- GitHub Action PR gate
- Figma plugin

One monthly limit covers all six.

contentrx.io/install

## 3/ The trust math is public

The substrate is private. The calibration is not.

contentrx.io/accuracy: measured kappa with 95% CIs.
contentrx.io/calibration: weekly drift log every Monday.

If the number drops, you see it before you feel it.

## 4/ The agent

Team plan adds a weekly review agent that opens a draft pull
request every Monday with the patterns ContentRX flagged on your
repo.

Read-only. Zero LLM calls per run. The digest renders from your
existing flag history. Cost: 0 checks per run.

## 5/ Try it

Free tier: 10 checks/month, no card.

Easiest path: paste a draft at contentrx.io/dashboard/explain. A
button label. An error message. A product update. A security
disclosure. Whatever your team is shipping.

Tell me where it falls short.

Robert (staff content designer, PayPal/Meta/Opendoor/Intuit)
