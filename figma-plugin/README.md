# Content standards checker — setup guide

Get the plugin running in under 2 minutes. You'll need the Figma desktop app and a ContentRX account.


## Step 1: Install the plugin

You need the Figma desktop app for this step (the web version doesn't support development plugins).

Open Figma desktop. Go to **Plugins → Development → Import plugin from manifest**. Navigate to the `content-standards-checker` folder you downloaded and select the `manifest.json` file. The plugin is now installed.


## Step 2: Sign in to ContentRX

Open any Figma file. Go to **Plugins → Development → Content standards checker**. The plugin panel opens on the right with a **Sign in** button. Click it — a tab opens in your default browser where you sign in or create a ContentRX account. Once you're done, return to Figma; the plugin picks up your session automatically and stores it on this device via Figma's client storage.

Evaluations run on the ContentRX backend — no personal API keys to manage. Usage counts against your plan's monthly quota, which you'll see below the results after each scan.


## Step 3: Scan your content

You have two options. **Scan page** checks every text layer on the current page — use this for a full audit. **Check selection** checks only the text layers inside whatever you have selected — use this to focus on a specific frame or component.

The plugin runs in two stages. First, it checks every text layer for mechanical issues (double spaces, missing commas, date format errors, "click here" link text, Latin abbreviations, dismissive language) instantly in-browser at zero quota cost. Then it sends the remaining strings to the ContentRX backend for nuanced evaluation (jargon detection, voice and tone, content structure, accessibility). Results appear in the panel with violations grouped by text layer. Click "Go to layer" on any result to zoom directly to it in your file.


## What the plugin checks

The plugin evaluates your content against 47 standards across 9 categories: clarity, voice and tone, consistency, accessibility, action-oriented writing, content structure, grammar and mechanics, inclusive language, and translation readiness. Mechanical checks (grammar, formatting, typography, accessibility anti-patterns) are caught instantly by the built-in preprocessor. Nuanced checks (clarity, tone, structure, accessibility) are evaluated by the ContentRX backend.

The plugin flags and cites. It does not generate rewrites. When it finds an issue, it tells you which standard was violated, what's wrong, and suggests a direction for fixing it. You decide how to fix it.


## Quota and plans

Every scanned text layer counts as one check against your monthly quota. The quota indicator below the results bar shows `X of Y this month` and your current plan. When you hit your quota the plugin surfaces a banner and stops further scans until the quota resets on the first of the next month — or until you upgrade.


## Feedback

We'd love to hear what you think. What worked? What didn't? Would you use this again? Share your feedback directly — every piece of input shapes what we build next.


## Troubleshooting

**"No text layers found"** — Make sure there are text layers on the current page (not just images, shapes, or components without text). Hidden layers are skipped intentionally.

**"Your session has expired"** — The plugin will bounce you back to the **Sign in** screen. Click it and re-authenticate in your browser.

**"Too many requests"** — You've hit the per-minute rate limit. Wait a few seconds and try again.

**Plugin not appearing** — Make sure you're using the Figma desktop app, not the web version. Go to Plugins → Development to find it.
