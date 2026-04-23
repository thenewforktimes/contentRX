# ContentRX docs

The spec site for `docs.contentrx.io` — the executable definition of
the content model that powers the ContentRX evaluator across Figma,
CLI, and CI.

## Stack

- Next.js 15 App Router
- Tailwind v4 + `@tailwindcss/typography`
- `@next/mdx` for prose pages
- Reads `../src/content_checker/standards/standards_library.json` at
  build time so docs stay in lock-step with the engine

## Local development

```bash
cd docs-site
npm install
npm run dev      # http://localhost:3001
```

## Production build

```bash
npm run build
npm run start    # http://localhost:3001
```

The build is fully static — `generateStaticParams` covers all 47 standard
pages, content types, and moments at compile time.

## Deploying to docs.contentrx.io

This site deploys from its own Vercel project (separate from the main
`content-rx.vercel.app` app, same repo). When setting up the project:

1. **Root directory**: `docs-site/`
2. **Framework preset**: Next.js (default)
3. **Domain**: `docs.contentrx.io`
4. **Environment variables**: none required

## Adding content

- New standards go into the engine's `standards_library.json`. They
  appear here automatically on the next build.
- The whitepaper, contributing guide, and moments page are hand-written
  MDX in `app/`. Edit those files directly.

See [`CLAUDE.md`](./CLAUDE.md) for architectural notes.
