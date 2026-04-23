# Figma Community submission package

Pre-drafted copy for the ContentRX plugin's Figma Community publish flow.
Revise as needed before hitting submit; Figma's review team looks at the
screenshots and tagline more than the long description.

Target deadline per BUILD_PLAN §6: **submit by end of launch week day 3**
so Figma's review queue has time to approve before the launch announcement.

---

## Tagline (65 characters max)

Primary (57 chars):

> Lint your UX copy against 47 content-design standards.

Alternates if Figma rejects the above:
- `AI-assisted content linter for UX writers and designers.` (56 chars)
- `Catch jargon, passive voice, and CTAs that go nowhere.` (54 chars)

---

## Description (~150 words)

ContentRX is a content-design linter for Figma. Scan any page or selection and
the plugin evaluates every text layer against 47 content standards covering
clarity, voice and tone, accessibility, action-oriented writing, grammar,
inclusive language, and translation readiness.

Mechanical issues — "click here" link text, Latin abbreviations, double
spaces, date formats, dismissive language — are caught instantly in-browser
at zero cost. Nuanced rules — jargon, tone mismatch, vague CTAs, weak
confirmations — are evaluated by a content-aware AI pipeline that knows the
difference between a button and a long-form paragraph.

Every violation cites a specific standard, explains what's wrong, and
suggests a direction for the fix. You decide how to rewrite.

Free plan: 25 scans/month. Paid plans unlock 5,000/month. Works in every
Figma file you can open. Your content stays on your device and the
ContentRX backend — it is never used to train models.

---

## Tags (Figma caps at 12)

Primary set:
- `content`
- `writing`
- `ux-writing`
- `content-design`
- `accessibility`
- `linting`
- `proofreading`
- `copywriting`
- `qa`
- `review`

Hold in reserve if Figma allows more:
- `ai`
- `productivity`

---

## Screenshot shot list (5 images, 1920×1080)

Figma Community displays these in a carousel. Each one is an opportunity to
pitch a different capability. Order matters — the first is the hero.

| # | Frame | What's in it | Why it earns the slot |
|---|-------|--------------|------------------------|
| 1 | **Hero** | Plugin panel open next to a realistic product screen (pricing page, onboarding, or dashboard). The panel shows a finished scan with mixed passes and fails. | First impression — proves the plugin evaluates _real_ copy, not toy examples. |
| 2 | **Selecting** | User highlighting a frame; plugin shows "Check selection" ready to go. Annotate the frame-tree with a soft outline. | Shows the easy-to-learn entry point. |
| 3 | **Violations** | Scan result card expanded. One standard-ID card visible with the violation text and the suggestion. | Proves the "cites + suggests" value prop. |
| 4 | **All passing** | A card with a green verdict and the "instant checks complete" line. | Counters "it just flags everything" skepticism. |
| 5 | **Settings** | Dashboard URL reminder + sign-out. Minimal; proves the plugin isn't hiding BYOK complexity. | Shows the plugin is a real product with an account, not a one-off script. |

Capture tips:
- Turn off dev-mode export button before capture (`DEV_MODE = false` in ui.html).
- Use Figma's own system fonts in the source design; Figma reviewers notice custom fonts that suggest the screenshot was mocked.
- Hide personal Figma team names in the file-chrome — crop or blur.
- 1920×1080 _final_ size; export at 2× and downscale for crispness.

---

## Demo video (30 seconds)

Format: MP4, 1080p, 30 seconds, no audio required (Figma plays muted by
default). Loom for recording → iMovie for trim → export.

Beat-by-beat script:

| Time | Action | On-screen |
|------|--------|-----------|
| 0:00–0:02 | Open plugin. "Sign in" button visible. | Plugin panel next to a file. |
| 0:02–0:05 | Click "Sign in", browser opens (speed up 2×), return to Figma. | Quick browser cameo, back to plugin. |
| 0:05–0:08 | Plugin shows signed-in empty state. | "Scan page / Check selection" visible. |
| 0:08–0:14 | Click **Scan page**. Progress bar fills. | Watch the "Instant checks" → "AI evaluation" handoff. |
| 0:14–0:22 | Results appear. Scroll through 2–3 violation cards. Expand one. | Standard ID + issue + suggestion on screen. |
| 0:22–0:27 | Click "Go to layer" on a violation. Figma zooms to the layer. | Camera movement — always good. |
| 0:27–0:30 | Cut back to plugin; end frame on quota "1 of 25 this month" counter and the tagline text overlay. | "Lint your UX copy — contentrx.io". |

Record at 1× speed; speed up only the browser-hop at 0:02–0:05 so the
Clerk sign-in doesn't dominate the demo.

---

## Submission checklist

Pre-req items that have to be real URLs/emails before Figma will accept:

- [ ] **Privacy policy URL** — blocks on BUILD_PLAN §5 (Iubenda page).
- [ ] **Support contact** — `hello@contentrx.io`, needs Resend inbound route from §13.
- [ ] **Plugin icon** — 128×128 PNG, dark + light variants if possible.
- [ ] **Cover image** — 1920×1080, same vibe as screenshot #1.
- [ ] `DEV_MODE = false` in ui.html.
- [ ] Remove `console.log` debug calls if any.
- [ ] Test the sign-in flow on a fresh Figma Desktop install (no cached
  `cx_token`) to confirm the cold-start UX matches the screenshots.

Post-submit:

- [ ] Confirm "In review" status in the Figma plugin dashboard.
- [ ] Calendar reminder for **day 10** to follow up if not approved.

---

## What Claude Code did vs. didn't do

Claude drafted the copy in this document. Screenshots and recording
require a human + Figma Desktop; BUILD_PLAN §6 explicitly calls those
out as human-in-the-loop deliverables. Revise the tagline and description
to match your voice before submitting.
