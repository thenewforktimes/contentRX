# First-comment + reply FAQs

Predictable questions across HN, X, Bluesky, PH. Answers below
are the canonical replies. Copy verbatim or lightly adapt to the
register of the surface (HN is technical, PH is friendlier, X
and Bluesky stay short).

The principle: every answer cites an artifact (a page, a file, a
public number) so the trust math is portable. "Read /accuracy"
beats "trust me" every time.

## Accuracy + calibration

### "How accurate is this, really?"

> The latest measurement lives at /accuracy and updates nightly.
> Two numbers: system kappa with 95% CI (how often the engine and
> a human content designer agree on a held-out set) and self-drift
> kappa (how stable the engine is week-to-week). Both ship with
> the kappa value, the CI, and the sample size; weeks where the
> kappa drops are shown, not hidden. /calibration logs the weekly
> movement so you can read the trend. If neither number tells you
> what you'd want it to, the free tier is 10 checks/month with no
> card. Paste your real strings and decide from there.

### "What if the kappa drops?"

> /calibration shows it. The whole pitch is the math is honest.
> Drift weeks are a feature of the surface, not a failure mode.
> They're how the team finds out which standards are slipping
> before customers feel it. The override stream feeds the
> refinement log; the refinement log feeds the next week's
> calibration; the next week's calibration ships at /calibration.

### "Why kappa? Why not just accuracy %?"

> Inter-rater reliability is the right number when the task is
> "two judges disagree on a borderline call." Plain accuracy %
> over-rewards a model that always says "pass." Kappa accounts
> for chance agreement; it's the standard metric for human-eval
> tasks like this. /accuracy explains the methodology in the
> footnote.

## Vs. competitors

### "Isn't this just Grammarly?"

> Grammarly catches grammar; ContentRX catches the layer above
> grammar. The content-design layer where "Submit" on a
> destructive button is grammatically fine but is the wrong verb
> for the moment, where a security disclosure is missing the
> three things a disclosure has to name. Different stack, same
> direction of "we'll catch the thing your reviewer would have."

### "Isn't this just an LLM with a system prompt?"

> The LLM is the last step, not the only one. Pipeline: classify
> the moment (what UI moment is this string in), filter standards
> (which content-design standards apply to that moment),
> preprocess (mechanical checks like apostrophes, repeated words,
> alt-text). These don't need an LLM at all. Then the LLM scan
> with the calibrated context, then validate, then merge. The
> substrate upstream of the LLM is what gives the verdict its
> shape.

### "Why not [other AI content tool]?"

> Try ContentRX on a string and try [other tool] on the same
> string. The free tier exists so the comparison is honest. The
> bet is that situation-awareness (the engine knows what UI
> moment the string is in) plus calibrated drift (you can see
> the model's reliability over time) plus team customization
> (custom rules + custom examples + the override stream) lands
> a better verdict than a generic content reviewer. If a
> specific string lands the wrong way, that's the kind of
> signal /calibration exists to log; reply with the input.

## Agent specifics

### "Why is the weekly agent V1 read-only? When does it actually fix things?"

> Agent V2 (draft-fix PRs) is parked deliberately. The decision
> rule: re-evaluate when V1 has run for 30+ days on at least 5
> paying Team-tier customers, with override-volume data on the
> V1 recommendations. Trust burns from autonomous mistakes are
> unrecoverable for a small team; V1 earns the next step. Today
> the agent is a renderer, not a generator. Every piece of
> substance in the digest already exists in the team's database
> before the worker runs. Zero LLM calls per run.

### "How does the agent know what to flag?"

> It reads the team's flag history (the violations table; every
> /api/check call from any surface logs a hash + the standard
> that fired). The agent groups by pattern, picks the top three,
> renders citations from the standards library's example pairs.
> Cold-start (no override history): the cited example is the
> standard's library example. Warmed-up (30+ flag decisions):
> the citation adds "your team has accepted this pattern's
> rewrites N times in the last 30 days; this digest follows the
> same pattern."

### "Does the agent run my code?"

> No. It reads two things: your team's flag history (already in
> our DB from your /api/check calls) and the GitHub repo's
> default-branch SHA (so it can open a draft PR off the latest
> code). The PR carries a marker file at
> .contentrx/agent-runs/<run-at>.md plus the digest as the PR
> description. No execution, no script-running, no editing your
> strings.

## Privacy

### "What happens to my strings?"

> The /api/check endpoint stores sha256(text) only. The plaintext
> string transits to Anthropic's API for the LLM scan; ZDR is
> active on our account so it's not retained. Per docs/copy-
> vocabulary.md the engine is calibrated to never repeat customer
> strings back to other customers; the substrate is built from
> aggregated patterns, not specific quotes.

### "Where's the privacy page?"

> /privacy. The subprocessor table lists every third-party that
> sees text: Anthropic for LLM calls, Vercel for hosting, Clerk
> for auth, Stripe for billing. /ethics goes deeper on the
> customer-not-product position.

### "Are you training on my strings?"

> No. The override stream feeds team-scoped calibration only.
> "This team has accepted X-shaped rewrites N times" stays
> inside that team's account. Cross-team aggregation is at the
> standard level (was-this-rule-overridden-globally) not the
> string level. The position is locked at /ethics commitment 3.

## Pricing

### "Why $39/mo for Pro?"

> 1,000 checks/month at $39 works out to $0.039 per check. A
> check is 200 characters; a typical product update email is
> 5-10 checks. The pricing matches the cost-of-goods (Anthropic
> tokens + Vercel) plus a margin that lets ContentRX exist as a
> standalone product, not a side project. /pricing has the
> per-check breakdown.

### "Why $99/seat for Team?"

> Two reasons: (a) the Team plan adds custom rules + custom
> examples + the weekly review agent (currently the only
> place the agent ships); (b) team plans concentrate value in
> the rule-curation flow, which costs more on our side because
> the override stream feeds team-scoped calibration. The
> alternative was a flat $39 with the agent in a separate SKU;
> the bet is that bundling beats SKU sprawl.

### "Will there be a free trial of Team plan?"

> Today no. The free tier (10 checks/month) covers the common
> case of "is the verdict any good." The agent is the
> Team-specific value; the dashboard's Run-preview-now button
> at /dashboard/agent renders the same digest a Team customer
> would receive every Monday, free, so the agent's value is
> testable without an upgrade.

## Stack questions

### "Why the GitHub App pattern? Why not just a webhook + bot?"

> The App pattern gets us scoped permissions (pull-requests:write
> + contents:write, nothing else), per-installation tokens with
> 1-hour TTL, and the Dependabot/Renovate-shaped install flow that
> teams already trust. The webhook + bot pattern would have us
> proxying a single token across customers; that scales worse on
> security review.

### "What MCP clients does the server work with?"

> Claude Code (`claude mcp add contentrx -- uvx contentrx-mcp`),
> Cursor (same MCP-add invocation), and any MCP client that
> speaks stdio. The server is `pip install contentrx-mcp` or
> `uvx contentrx-mcp`. /install#mcp has the full snippet.

### "Can the LSP work with [editor]?"

> Anything with an LSP client. VS Code and Cursor get the
> ContentRX extension from their marketplaces; Zed / Neovim /
> JetBrains / emacs lsp-mode point their LSP client at
> `contentrx-lsp` (stdio, `uv tool install contentrx-lsp` or
> `pipx install contentrx-lsp`). /install#lsp has snippets.

## Negative scenarios

### "Your engine is wrong on this specific string [...]."

> Thanks. That's exactly the kind of signal /calibration is
> built to log. /dashboard/explain has a "Flag for review" button
> on every verdict that routes the case to the founder review
> queue; if you're not signed in, paste the input + the flag in
> a reply and I'll add it manually. Drift weeks are a feature of
> the surface, not a failure mode.

### "Show HN is full of AI content fatigue, why should we pay attention?"

> Fair. ContentRX's claim isn't "AI fixes content design"; it's
> "a calibrated content-design pipeline catches what your
> reviewer would have, and ships the calibration math publicly so
> you can decide whether the catch holds up over time." If the
> /accuracy page reads as honest, the rest of the surface earns
> its read; if not, the calibration log is where the
> conversation stays.

### "Why does this need to be a product? Why not a system prompt + a Claude project?"

> Honest answer: for one team it doesn't. The product is the
> calibrated substrate, the team-scoped override layer, the
> drift tracking, the six surfaces with one monthly limit, and
> the staff-content-designer judgment baked into the prompt
> work. If a single team's prompt-engineering investment beats
> ContentRX on their specific strings, that's a fair outcome.
> The goal is good content design, not lock-in.

## Closing replies

### "Cool launch, good luck."

> Thanks. The most useful thing you can do is paste a real string
> at /dashboard/explain and tell me where the verdict reads wrong;
> the second-most-useful is forward this to the content designer
> on your team and ask whether the moat language reads as honest.

### "I have feedback."

> hello@contentrx.io for general feedback, security@contentrx.io
> for vulnerabilities. /privacy lists the three subprocessors and
> the ZDR posture if that's the direction your feedback runs.
