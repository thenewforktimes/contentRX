# Product Hunt launch draft

PH wants three things at submission: a tagline (60 chars), a
description (260 chars), and the first comment from the maker. The
gallery (screenshots / GIF / videos) carries about half the sign-up
conversion; pick those carefully on launch day.

## Tagline (60 chars cap)

Three options, pick the one that lands the moat clearest:

1. **"Staff-level content design review on every string you ship"**
   (58 chars; reuses the homepage hero verbatim. Calm, brand-safe,
   high-signal.)
2. **"The content model your strings deserved"** (40 chars; punchier,
   more emotional, less specific.)
3. **"Your AI reviewer, with a content designer's judgment"**
   (53 chars; positions vs. generic AI assistants.)

Recommended: option 1.

## Description (260 chars cap)

> ContentRX is a content-design pipeline that wraps an LLM with the
> context it needs to render a real verdict on every string your team
> ships. Six surfaces (MCP, LSP, CLI, GitHub Action, dashboard paste
> mode, Figma plugin), one monthly limit, calibrated drift tracked
> weekly.

Length: 247 chars. Fits.

## First comment from the maker

Uncapped, but PH default surface width is ~600px, so keep
paragraphs short.

> Hey PH, I'm Robert. Staff content designer at PayPal, after Intuit,
> Meta, Opendoor.
>
> ContentRX is the content model I wish existed when my team was
> reviewing 200 PR strings a week and the choice was either three-day
> human review or a generic AI assistant that didn't know what it
> was looking at.
>
> What's different from a generic AI reviewer:
>
> 1. **Situation-aware**: the engine classifies the UI moment first
>    ("destructive action," "compliance disclosure," "first
>    encounter"), then picks the content-design standards that apply
>    to that moment, then runs the LLM with that context. Not a
>    "review this string" prompt; a calibrated pipeline.
> 2. **Calibration is public**: I publish the kappa with 95% CIs on
>    contentrx.io/accuracy and a weekly drift log on
>    contentrx.io/calibration. If the model slips a week, you see
>    it before you feel it.
> 3. **One engine, six surfaces**: MCP server for Claude Code and
>    Cursor, LSP for VS Code / Cursor / Zed, CLI, GitHub Action with
>    PR gating, dashboard paste mode for long-form (product updates,
>    security disclosures, all-hands emails), and a Figma plugin for
>    design-time review. One monthly limit covers everything.
> 4. **Team plan adds a weekly review agent** that opens a draft PR
>    every Monday with the patterns ContentRX has flagged on your
>    repo. Read-only; the agent never edits your strings. Zero LLM
>    calls per run; the digest is rendered from your existing flag
>    history.
>
> Free is 10 checks per month, no card. Pro is $39/mo with 1,000
> checks. Team is $99/seat.
>
> Easiest way to feel out whether the judgment lands: paste a
> string at contentrx.io/dashboard/explain. A button label. An
> error message. A paragraph from a product update email. Tell me
> where the verdict reads wrong.
>
> Critical replies welcome.

## Gallery / screenshots

What to capture. PH lets you upload up to ~10 images + 1 GIF/video.
Order matters (the first three drive most clicks).

Recommended order:

1. **Dashboard paste-mode hero shot.** Paste mode with a draft
   product update email loaded, the digest panel showing the
   document-level diagnostic + categorized flags + the suggested
   rewrite. Cropped wide, light-mode if PH skews light.
2. **MCP server in Claude Code.** A Claude Code conversation where
   the user asks for a button label, the LLM invokes
   `evaluate_copy`, the verdict shows up inline.
3. **The /writes gallery.** The six long-form examples on the
   `/writes` page, scrolled to show all six labels.
4. **Figma plugin in action.** The plugin panel with a verdict +
   suggested rewrite on a real-looking error message.
5. **GitHub Action PR comment.** A real PR comment with the
   verdict + violations + the suggestion.
6. **`/calibration` snapshot.** A screenshot of the weekly drift
   log, showing kappa over time. The receipt for the trust math.
7. **`/dashboard/agent` Run-preview-now.** A screenshot of the
   live digest preview, ideally a warmed-up account so the citations
   show "your team has accepted N times" framing.

A 30-second GIF cycling through the six surfaces with their inputs
and verdicts would also work as the lead asset; harder to produce
on launch morning but worth considering if there's time.

## Replies / engagement

Keep one tab on the PH page, one on Twitter / Bluesky. The PH
algorithm rewards engagement in the first 4 hours; expect comments
to outnumber sign-ups 3:1 on day one. The same FAQ snippets from
[show-hn.md](show-hn.md) work for PH replies, in a slightly warmer
register than HN, slightly less technical. Don't paste them
verbatim across surfaces (PH readers may also be on HN); rephrase
the same substance.
