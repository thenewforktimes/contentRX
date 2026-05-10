# Show HN draft

Two versions below. Pick the one that fits the day's framing better;
the second is tighter, the first lands the moat clearer. Title is
the same in both.

## Title (verbatim)

> Show HN: ContentRX – Staff-level content design review in every repo

(60 chars; HN cap is 80; the dash is an en-dash because HN renders
em dashes inconsistently across browsers. Robert's call on whether
to swap.)

## Body, Version 1 (longer, leads with the moat)

I'm Robert, a staff content designer who's spent ten years writing
strings at Intuit, Meta, Opendoor, and now PayPal. ContentRX is the
content model I wish existed when my team was reviewing 200 PR
strings a week and the choice was either three-day-turnaround human
review or a generic AI assistant that didn't know what it was
looking at.

It's a content-design pipeline that wraps an LLM with the context
the LLM needs to render a real verdict: which UI moment the string
lives in, which content-design standards apply, which patterns the
team has already pushed back on. The verdict is a small public
envelope (issue, suggestion, severity, confidence) that ships to
six surfaces:

- **Dashboard paste mode**: paste a button label, an error message,
  a product update email, or a security advisory. Up to 50,000
  characters. Get the document-level diagnostic, a clean rewrite,
  and the categorized flags.
- **MCP server**: `uvx contentrx-mcp`. Inline review during
  generation in Claude Code, Cursor, or any MCP client.
- **LSP server**: yellow squiggles in any LSP editor. Right-click
  to rewrite in place.
- **CLI**: `pip install contentrx-cli && contentrx-cli check ...`.
- **GitHub Action**: PR gate. `fail-on: review` blocks merge on
  worth-a-look verdicts.
- **Figma plugin**: design-time review of the strings that arrive
  through the design tool.

The bet is that content-design review at this scale only works if
one designer's judgment shows up consistently across surfaces. The
substrate is private (calibrated standards, weekly drift logs,
override-stream-driven refinements). The calibration math is public:

- `/accuracy` ships measured kappa with 95% CIs and a measured
  self-drift kappa.
- `/calibration` posts the previous week's kappa movement, drift
  signals, and which standards were refined. Every Monday.
- `/reports` is the quarterly accuracy report; the latest is
  generated nightly from the substrate.

If the number drops, customers see it before they feel it. That's
the trust contract: I publish the math, customers can decide whether
the review-quality holds up over time.

Free tier: 10 checks/month, no card. Pro is $39/mo with 1,000
checks. Team plan adds custom rules + a weekly review agent that
opens a draft PR every Monday with the patterns ContentRX has
flagged on your repo (read-only, zero LLM calls per run, the
digest is rendered from the team's existing flag history).

Honest about what's not there yet:
- Agent V2 (draft-fix PRs) is parked until V1 has run for 30+ days
  on Team-tier teams with override-volume data on V1
  recommendations.
- The taxonomy is private; we don't publish the standards library.
- Translation / localization is out of scope. ContentRX is a
  review tool, not a translation tool.

Critical replies welcome. The pitch lives or dies on whether the
content design judgment shows up on your real strings. Paste
something into `/dashboard/explain` and tell me where it gets it
wrong.

Robert

## Body, Version 2 (tighter, leads with the use)

I'm Robert, a staff content designer at PayPal (after Intuit, Meta,
Opendoor). ContentRX is the content model I wish existed when my
team was reviewing 200 PR strings a week.

Not an LLM with a prompt. A content-design pipeline that gives the
LLM the context it needs to render a real verdict: which UI moment
the string lives in, which content-design standards apply, which
patterns the team has already pushed back on. Verdict is four
fields: issue, suggestion, severity, confidence.

Six surfaces, one engine, one monthly limit:

- Dashboard paste mode (`/dashboard/explain`)
- MCP server: `uvx contentrx-mcp`
- LSP for VS Code / Cursor / Zed
- CLI: `pip install contentrx-cli`
- GitHub Action with `fail-on: review` PR gate
- Figma plugin

The trust contract: `/accuracy` reports measured kappa with 95% CIs;
`/calibration` posts a weekly drift log. If the model slips a week,
customers see it before they feel it.

Pricing: free 10/month, Pro $39/mo with 1,000 checks, Team adds
custom rules + a weekly review agent (read-only, zero LLM per run).

Critical replies welcome. Paste something into `/dashboard/explain`
and tell me where it gets it wrong.

Robert

## First-comment FAQ post (fire within 60 seconds)

The HN first-comment slot is where the answers to the predictable
skepticism go. Pre-write so it lands fast:

> A few questions I expect, with the honest answers up front:
>
> **"Is this just GPT/Claude with a content-design prompt?"** No,
> and yes. The LLM is downstream. Upstream: a classifier that names
> the UI moment, a filter that picks the relevant content-design
> standards, a preprocessor that catches mechanical issues without
> the LLM, an ensemble that flags low-confidence cases for review.
> The substrate is private but the calibration is public:
> `/calibration` posts every Monday's kappa movement.
>
> **"How do I trust your accuracy numbers?"** I publish them with
> 95% CIs at `/accuracy` and re-measure weekly. Drift weeks are
> shown, not hidden. The `/calibration` log is the receipt.
>
> **"What about my custom voice / brand guidelines?"** Team plan
> adds custom rules + custom examples. Override decisions feed back
> into team-scoped calibration; the engine learns "this team
> accepts X-shaped rewrites N times in the last 30 days" and the
> weekly agent cites that history when it surfaces patterns.
>
> **"Why six surfaces?"** Different review moments. The MCP server
> is for the loop where the LLM writes the string in the first
> place; the LSP is for diagnostics-as-you-type; the GitHub Action
> is for PR gates; the dashboard paste mode is for long-form
> writing your team sends to itself (security disclosures,
> all-hands emails, policy notices). One engine, one monthly limit,
> one team-rule layer across all six.
>
> **"Privacy?"** Customer strings get sha256-hashed at the boundary;
> only hashes persist. PII is screened pre-LLM. The Anthropic ZDR
> path is on the account. Subscription is the entire revenue model;
> no data resale.
>
> Happy to dig into any of these. The pitch lives or dies on whether
> it gets your real writing right; paste something at
> `/dashboard/explain` and tell me where it falls short.

## Reply snippets (keep these as text expansions for fast paste)

**On accuracy claims:**
> `/accuracy` reports the latest kappa with its 95% CI; the page
> auto-regenerates nightly. Self-drift is measured separately so a
> week where the model disagrees with itself reads as a flag, not
> as an unrelated metric. If a critic's specific copy lands a wrong
> verdict, that's the kind of signal `/calibration` exists to log.

**On "isn't this just Grammarly?":**
> Grammarly catches grammar; ContentRX catches content-design
> issues that grammar checkers don't have a vocabulary for. The
> situation-aware verdict ("'Submit' on a destructive button is a
> form-ceremony verb, not an outcome verb"), brand-rule-aware
> overrides, custom-example short-circuits. Different stack, same
> direction of "we'll catch the thing your reviewer would have."

**On "isn't this just a system prompt?":**
> The LLM is the last step, not the only one. Pipeline:
> classify_moment, then filter_standards, then preprocess
> (mechanical checks, no LLM), then LLM scan, then validate, then
> merge. The substrate upstream of the LLM is the moat; the LLM is
> the renderer. See `/about` for the longer version.

**On "this'll be wrong on my niche stack":**
> Probably, on day one. The way the engine gets calibrated to a
> team is the override stream: every "agree / disagree / ship
> anyway" decision feeds the weekly drift log. After ~30 decisions
> the warmed-up trust opener kicks in on the weekly digest:
> "informed by your last N flag decisions, your M custom examples,
> your K active team rules." The cold-start path is honest about
> being the cold-start path.
