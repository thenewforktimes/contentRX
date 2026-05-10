# X (Twitter) thread draft

Eight-tweet thread. Fire #1, then thread the rest at one-minute
intervals so the algo reads it as a coherent thread, not a burst.

Each tweet is under 280 chars. No em dashes (voice rule 2). One
specific claim per tweet, with the artifact link where it earns
trust.

---

## 1/ The hook

Today I'm launching ContentRX in public beta.

It's the content model I wish existed when my team was reviewing
200 PR strings a week.

Staff-level content design review on every string you ship. And on
the longer-form writing your team sends to itself.

contentrx.io

## 2/ What it actually is

Not an LLM with a prompt. A content-design pipeline that gives the
LLM the context it needs to render a real verdict.

Classify the UI moment. Filter the standards. Preprocess. Scan.
Validate. Merge. The LLM is the renderer, not the engine.

## 3/ Where it runs

Six surfaces, one engine, one monthly limit:

- Dashboard paste mode (paste a draft, get the digest)
- MCP server (Claude Code, Cursor)
- LSP (VS Code, Cursor, Zed)
- CLI
- GitHub Action with fail-on: review
- Figma plugin

contentrx.io/install

## 4/ The trust contract

I publish the calibration math.

contentrx.io/accuracy: measured kappa with 95% CIs.
contentrx.io/calibration: weekly drift log.

If the number drops, you see it before you feel it. Drift weeks are
shown, not hidden.

## 5/ The agent

Team plan adds a weekly review agent: a draft pull request every
Monday with the patterns ContentRX has flagged on your repo.

Read-only. Zero LLM calls per run. The digest is rendered from your
team's existing flag history. Cost: 0 checks per run.

## 6/ Where I'm coming from

Staff content designer at PayPal, Meta, Opendoor, Intuit.

The bet: content-design review at scale only works if one
designer's judgment shows up consistently across the surfaces. The
substrate is private; the calibration is public.

contentrx.io/about

## 7/ Pricing

Free: 10 checks/month, no card.
Pro: $39/mo, 1,000 checks.
Team: $99/seat, 2,000/seat, custom rules + the weekly agent.

If the engine gets your real writing wrong, the free tier shows
that for free.

## 8/ Try it now

Easiest path: paste a draft at contentrx.io/dashboard/explain.

A button label, an error message, a product update email, a
security disclosure. Whatever your team is shipping this week.

Tell me where it gets it wrong.

Robert
