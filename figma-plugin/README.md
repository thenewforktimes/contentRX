# Content standards checker — setup guide

Get the plugin running in under 2 minutes. You'll need the Figma desktop app and the beta API key included in your onboarding message.


## Step 1: Install the plugin

You need the Figma desktop app for this step (the web version doesn't support development plugins).

Open Figma desktop. Go to **Plugins → Development → Import plugin from manifest**. Navigate to the `content-standards-checker` folder you downloaded and select the `manifest.json` file. The plugin is now installed.


## Step 2: Run the plugin and enter your API key

Open any Figma file. Go to **Plugins → Development → Content standards checker**. The plugin panel opens on the right. Paste the beta API key from your onboarding message and click "Save key." Your key is stored locally on your device using Figma's client storage — it's never sent anywhere except the Anthropic API.

The beta key covers all AI evaluation costs during the testing period. After the beta, you'll use your own Anthropic API key (free to create at console.anthropic.com — new accounts include free credit).


## Step 3: Scan your content

You have two options. **Scan page** checks every text layer on the current page — use this for a full audit. **Check selection** checks only the text layers inside whatever you have selected — use this to focus on a specific frame or component.

The plugin runs in two stages. First, it checks every text layer for mechanical issues (double spaces, missing commas, date format errors, "click here" link text, Latin abbreviations, dismissive language) instantly at zero API cost. Then it sends the remaining strings to Claude for nuanced evaluation (jargon detection, voice and tone, content structure, accessibility). Results appear in the panel with violations grouped by text layer. Click "Go to layer" on any result to zoom directly to it in your file.


## What the plugin checks

The plugin evaluates your content against 46 standards across 9 categories: clarity, voice and tone, consistency, accessibility, action-oriented writing, content structure, grammar and mechanics, inclusive language, and translation readiness. 16 mechanical checks (grammar, formatting, typography, accessibility anti-patterns) are caught instantly by the built-in preprocessor. Nuanced checks (clarity, tone, structure, accessibility) are evaluated by Claude's AI.

The plugin flags and cites. It does not generate rewrites. When it finds an issue, it tells you which standard was violated, what's wrong, and suggests a direction for fixing it. You decide how to fix it.


## Cost during beta

The beta key covers all AI evaluation costs. You don't pay anything during the testing period. For reference, each page scan costs approximately $0.02-0.05 in API usage depending on the number of text layers. The plugin batches strings together to minimize API calls — a 30-layer page uses 3-5 API calls, not 30.


## Feedback

We'd love to hear what you think. What worked? What didn't? Would you use this again? Share your feedback directly — every piece of input shapes what we build next.


## Troubleshooting

**"No text layers found"** — Make sure there are text layers on the current page (not just images, shapes, or components without text). Hidden layers are skipped intentionally.

**"API error 401"** — Your API key is invalid or expired. Go to Settings in the plugin and re-enter your key.

**"API error 429"** — You've hit the Anthropic rate limit. Wait 30-60 seconds and try again. This is more likely with free-tier API accounts.

**Plugin not appearing** — Make sure you're using the Figma desktop app, not the web version. Go to Plugins → Development to find it.
