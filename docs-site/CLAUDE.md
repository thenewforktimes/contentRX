# docs-site — Claude Code instructions

This is the **ContentRX documentation site**. It deploys to
`docs.contentrx.app` from its own Vercel project, separate from the main
`content-rx.vercel.app` app, but lives in the same repo so the docs can
read directly from `../src/content_checker/standards/standards_library.json`
at build time.

## What's locked

- Next.js 15 App Router, TypeScript, Tailwind v4
- `@next/mdx` for long-form pages (whitepaper, contributing, moments)
- TSX pages for data-driven content (standards index, individual standards)
- Standards page is a dynamic `[id]` route with `generateStaticParams`
  so all 47 pages pre-render at build
- No Nextra (would require an additional design system the rest of the
  monorepo doesn't use)
- No client state — every page is a Server Component

## How standards data flows

1. Source of truth: `src/content_checker/standards/standards_library.json`
   in the parent repo (engine).
2. `lib/standards.ts` reads it at request/build time via
   `process.cwd() + "../src/content_checker/standards/..."`.
3. `app/spec/standards/[id]/page.tsx` exports `generateStaticParams()`
   that walks every standard ID, so SSG covers all 47 pages.

When the engine bumps the standards library (via a new minor version),
this site's content updates on the next deploy automatically — there is
no separate sync step.

## Moments

Moments live in `src/content_checker/moments.py` (Python data, not JSON).
The current `app/spec/moments/page.mdx` is hand-written until a sibling
`moments.json` is exported alongside the standards library. Keep the
hand-written page in sync with the Python source until that lands.

## Deploying

This site has its own `vercel.json` / `vercel.ts` (TBD when the user
creates the new Vercel project) and its own `docs.contentrx.app` domain.

```bash
cd docs-site
npm install         # first time only
npm run dev         # localhost:3001
npm run build       # production build (reads engine JSON)
```

For the production deploy, the Vercel project should:
1. Set "Root directory" to `docs-site/`
2. Use the default Next.js framework preset
3. Bind the `docs.contentrx.app` domain
4. No env vars are needed — the site is fully static-from-JSON
