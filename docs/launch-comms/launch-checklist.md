# Launch checklist

The day-of order to fire each post, what to expect, and where each
draft lives. Keep this open in a tab on launch day.

## Pre-launch (the morning of)

- [ ] Verify `/accuracy` and `/calibration` show fresh numbers (not
      a stale snapshot from last week).
- [ ] Smoke-test the four primary install surfaces from a clean
      shell: `uvx contentrx-mcp`, `pip install contentrx-cli &&
      contentrx-cli check ...`, `/dashboard/explain` paste flow,
      Figma plugin install (already in Community).
- [ ] Smoke-test `/dashboard/agent` Run-preview-now from a fresh
      account and from a warmed-up account so you can screenshot
      both states for replies if asked.
- [ ] Hit `/api/cron/agent-run` once with the cron secret to make
      sure the cron path is healthy.
- [ ] Pull a fresh status from `/status` to confirm all three
      health probes (DB, engine, queue) are green.
- [ ] Read [first-comment-faqs.md](first-comment-faqs.md) start to
      end so the first reply lands fast.

## Firing order (mid-morning, ~10:30am Pacific)

1. **Show HN.** See [show-hn.md](show-hn.md). Paste the body, set
   the title verbatim, fire. The first comment is the FAQ post; fire
   it within 60 seconds of the submission going live.
2. **X thread.** See [x-thread.md](x-thread.md). Fire the first
   tweet, then thread the rest at one-minute intervals so the algo
   reads them as a coherent thread, not a burst.
3. **Bluesky thread.** See [bluesky-thread.md](bluesky-thread.md).
   Same shape as X but slightly different copy because the audience
   reads differently. Fire ~20 minutes after X so the same followers
   on both don't feel cross-posted-at.
4. **Product Hunt.** See [product-hunt.md](product-hunt.md). PH
   wants the launch fired at midnight Pacific so it gets a full day;
   if launch day is also a PH day, schedule it for the prior
   midnight. The Show HN can run on its own day.

## What to expect

- **First hour: Show HN comment chaos.** HN moves fast for the first
  60-120 minutes. Expect skepticism on accuracy claims and AI-fatigue
  pushback. The `/calibration` link is the answer to ~80% of the
  honest questions; the answer to "is this just an LLM with a prompt"
  is the calibration log + the named-expert byline. Save the
  prepped FAQ replies as text snippets so you can post them fast
  without retyping.
- **Hours 2-6: developer-Twitter pickup.** Folks who saw HN +
  occasional MCP-related accounts may screenshot the dashboard
  paste-mode + the agent preview. Expect a small bump on
  /dashboard sign-ups; expect a larger bump on `/install` reads
  (people checking the surface area before signing up).
- **Day 1 evening: PH leaderboard placement decided.** If PH is
  active that day, top-3 by upvotes by ~5pm Pacific is the bar to
  watch.

## Things NOT to do on launch day

- Don't reply to every comment. The signal-to-noise of HN comments
  is rough; reply to the top three concerns with substance and let
  the rest live.
- Don't claim accuracy numbers higher than `/accuracy` reports.
  The whole pitch is the calibration math is honest; an offhand
  "we're at 85% accuracy" tweet that contradicts the page costs
  more than a more conservative claim would have gained.
- Don't ship a feature in response to a comment thread. Comment
  threads will surface the V2 roadmap (agent fix-PRs, repo
  selection, more languages). The roadmap stays the roadmap;
  launch-day feature requests go in a Linear backlog if anything.

## Asset links to keep handy

- `/accuracy` is the kappa + CI page.
- `/calibration` is the weekly drift log.
- `/writes` is the long-form gallery.
- `/install` is every install surface in one place.
- `/pricing` is the free/Pro/Team breakdown.
- `/dashboard/agent` is the weekly review agent surface.
- `/about` is the named-expert positioning, links to Robert's career
  arc.

## Rollback play (if something goes wrong)

If a check fails post-launch (e.g. an engine bug surfaces):

1. Hit `/status` first; if the probes are green, the "bug" is likely
   one customer hitting an edge case rather than an outage.
2. If the probes are red, post one update on each surface ("we're
   investigating [the failure mode]; status at [/status]") and stop
   accepting new sign-ups via the marketing toggle (TBD; wire one
   if needed).
3. The cron is read-only. Even if the agent has a bug, no
   customer-visible side effects happen until the next Monday. Fix
   in calm.
