# Content standards checker — Figma plugin

A Figma plugin that checks selected text layers against your content standards using Claude.

## Setup

1. Open Figma desktop
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select `manifest.json` from this folder
4. Run the plugin and enter your Anthropic API key

## Usage

1. Select one or more text layers in Figma
2. Click **Check selected text**
3. Review the pass/fail verdict and any violations

## How it works

Figma plugins have a split architecture:

- **Sandbox thread** (`code.js`) — reads text layers from the Figma document and manages API key storage via `figma.clientStorage`
- **UI thread** (`ui.html`) — renders the interface, calls the Claude API directly, and displays results

They communicate via `postMessage`. The standards library is embedded in `ui.html` to avoid extra network calls.

## API key storage

Your key is stored locally on your machine using Figma's `clientStorage` API. It persists across sessions but never leaves your device except to call `api.anthropic.com` directly.

The `anthropic-dangerous-direct-browser-access` header is required for browser-based API calls. This is included in the request headers automatically.

## Files

```
manifest.json   Plugin config, declares network access to api.anthropic.com
code.js         Sandbox thread — Figma API access
ui.html         UI thread — interface, embedded standards, API calls
```

## Updating standards

The standards library is embedded as a JavaScript object in `ui.html`. To update it, replace the `STANDARDS` object with the contents of `../standards/standards_library.json`. A build script to automate this is on the roadmap.
