# docs-site — Claude Code instructions

This is the **ContentRX documentation site**. It deploys to its own
Vercel project (target domain: `docs.contentrx.app` per the
post-pivot ADR), separate from the main app, but lives in the same
monorepo so the build can co-evolve with the engine.

## What's locked

- Next.js 15 App Router, TypeScript, Tailwind v4.
- `@next/mdx` for long-form pages (whitepaper, contributing, guides).
- No Nextra. No client state. Every page is a Server Component.
- **Public taxonomy is not part of this site.** Per ADR
  `decisions/2026-04-25-private-taxonomy-pivot.md`, the 47 standards,
  13 moments, per-standard versioning, and rationale chain are
  internal artifacts only. Phase D (#129) removed the `/spec/*` and
  `/model/*` routes that previously rendered them; the loaders in
  `lib/standards.ts` / `lib/moments.ts` / `lib/changelog.ts` and the
  vendored substrate JSON are gone with them.

## What this site renders today

- `app/page.mdx` — landing.
- `app/whitepaper/page.mdx` — methodology, redacted of substrate.
- `app/contributing/page.mdx` — rewritten for the private-taxonomy
  posture (no "open the standards-library JSON" instructions).
- `app/guides/*` — public hand-written guides (error messages, Figma
  design review, Next.js + shadcn buttons, custom examples).

## Public-credibility surfaces

These live in the **main** app (`contentrx.app`), not here:

- `/accuracy` — measured kappa with 95% CI, design target, generated
  nightly from substrate. Source: `reports/accuracy/latest.json` in
  the parent repo.
- `/calibration` — weekly calibration log entries. Source:
  `reports/calibration/<YYYY>-<WW>.md`.
- `/essays` — monthly named-expert essays in Robert's voice.
  Source: `contentrx-docs/essays/` (target — the staging area is
  `essays/drafts/` in the parent repo until promotion).
- `/reports` — quarterly reports. Source:
  `reports/quarterly/<YYYY>-<Q>.md`.

When these land on `docs.contentrx.app` (planned), they'll either be
copied via Nextra includes from the parent repo's `reports/` directory
or proxied via the main app's API. The deploy split is not yet wired.

## What not to do

- Don't reintroduce a `/spec/*` or `/model/*` route. Those were
  removed in Phase D for ADR-level reasons.
- Don't import substrate JSON from the engine. The vendored copies
  are gone; importing from the parent's `src/content_checker/standards/`
  re-leaks the private taxonomy into the public bundle.
- Don't add a `lib/standards.ts` / `lib/moments.ts` / `lib/changelog.ts`
  loader. If a future ADR supersedes the 2026-04-25 pivot, the
  reactivation is gated on that ADR landing first.

## Deploying

```bash
cd docs-site
npm install
npm run dev         # localhost:3001
npm run build       # production build
```

Vercel project setup:
1. "Root directory" → `docs-site/`
2. Default Next.js framework preset
3. Bind `docs.contentrx.app` once the domain is ready
4. No env vars needed
