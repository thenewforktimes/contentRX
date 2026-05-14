import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Audit S6 — companion security headers.
//
// CSP was here too in the first cut, but it broke Clerk's frontend
// SDK in production: the script-src allowlist (`*.clerk.com`,
// `*.clerk.accounts.dev`) didn't cover the actual Frontend API
// origin Clerk serves at production scale, so /sign-in rendered as a
// black screen with the Clerk script blocked. Reverted to ship the
// page; rebuild it from Clerk's published recommendations once we
// can confirm the production Clerk Frontend API URL against the live
// CSP report from a working environment.
//
// The other defenses against customer-content leakage stay in place
// — PII pre-screen at /api/*, Sentry beforeSend scrubber,
// safe-error-log helper. CSP was defense-in-depth on top of those.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  { key: "X-Frame-Options", value: "DENY" },
  // Audit L3 (2026-05-13): make HSTS explicit. Vercel injects HSTS by
  // default on contentrx.io, so this is belt-and-suspenders rather
  // than a new control — but pinning the policy in code means it
  // survives any future deploy-target change. Matches the value
  // promised in SECURITY.md's "Transport security" section
  // (max-age=63072000 = 2 years; preload eligible). Note: `preload`
  // is an opt-in to the browser preload list at hstspreload.org —
  // keep it in only if domain is already (or about to be) submitted.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Drop dead exports from barrel files at build time. Closes audit M-34.
  // react-email exposes a deep barrel file; without this, importing a
  // single email component pulls every component into the bundle.
  // (Recharts was here pre-Pf7 — replaced by a hand-rolled SVG.
  // `lucide-react` was here through 2026-05-14 but isn't in
  // `package.json` and isn't imported anywhere in `src/`, so removed
  // as part of the Phase 3 zombie cleanup.)
  //
  // framer-motion is added 2026-05-14 (Phase 4 audit fix). Used by
  // AnimatedWordmark, MotionList, and HowItWorksDiagram — small
  // surface area, but the package's default barrel pulls more than
  // the named exports need. With this hint, Next.js tree-shakes to
  // just the entry points actually referenced.
  experimental: {
    optimizePackageImports: [
      "@react-email/components",
      "framer-motion",
    ],
  },
  // Server-only deps that don't need to be webpack-bundled. Trims
  // server build time and silences the big-string serialization warnings.
  serverExternalPackages: [
    "postgres",
    "stripe",
  ],
  async headers() {
    return [
      {
        // Apply to every page + API route. CORS handlers on /api/*
        // attach their own headers per-request; these are extras that
        // browsers honor regardless.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        // Phase 6 of the pre-pilot launch build promoted
        // /dashboard/team/rules to /dashboard/rules (canonical for
        // every plan tier, with conditional rendering). Keep the
        // legacy URL working for in-the-wild bookmarks + emails.
        // 308 (permanent) so browsers + crawlers update their
        // caches; the route is gone for good.
        source: "/dashboard/team/rules",
        destination: "/dashboard/rules",
        permanent: true,
      },
      {
        // /sources retired 2026-05-06 (ADR 2026-05-06-sources-page-
        // retired). 2026-05-11: /ethics's Commitment 4 ("Sources I
        // have rights to use") was cut, so the prior deep-link target
        // (#no-stolen-content) no longer exists. Old /sources
        // bookmarks now land on /ethics generally. 308 because the
        // route is gone for good.
        source: "/sources",
        destination: "/ethics",
        permanent: true,
      },
      {
        // /about retired 2026-05-10. The page's two paragraphs
        // duplicated /ethics (calibration commitment) and /accuracy
        // (the nightly kappa publication), and the named-byline
        // moat already sits on the homepage via AuthorBlock. /ethics
        // is the closest substantive landing — it carries the
        // customer-not-product contract, the calibration commitment,
        // and the AuthorBlock at the foot. 308 because the route is
        // gone for good.
        source: "/about",
        destination: "/ethics",
        permanent: true,
      },
      {
        // /calibration retired 2026-05-11. The weekly calibration log
        // folded into /accuracy as a dedicated section (#calibration-log)
        // and per-week deep-links now point at the raw markdown on
        // GitHub. Footer simplified to four Trust links. Both the
        // index and the per-week routes land on /accuracy — old deep
        // links find the weekly list there. 308 because the routes are
        // gone for good.
        source: "/calibration",
        destination: "/accuracy#calibration-log",
        permanent: true,
      },
      {
        source: "/calibration/:week",
        destination: "/accuracy#calibration-log",
        permanent: true,
      },
      {
        // /reports retired 2026-05-11 (round-4 audit). The quarterly
        // accuracy report content is folded into /accuracy alongside
        // the calibration log — same consolidation pattern as
        // /calibration. The raw quarterly markdown still lives at
        // `reports/quarterly/<YYYY-Q>.md` for the founder to hand-edit
        // and for /admin/reports to render. 308 because the public
        // route is gone for good; CLAUDE.md updated in the same PR
        // so the "/reports is a public surface" claim no longer
        // promises a route that 404s.
        source: "/reports",
        destination: "/accuracy#quarterly-reports",
        permanent: true,
      },
      {
        source: "/reports/:quarter",
        destination: "/accuracy#quarterly-reports",
        permanent: true,
      },
    ];
  },
};

// Compose: bundle analyzer wraps the base config first (so it sees
// the resolved webpack config), then Sentry wraps the result so its
// build-time hooks still run.
export default withSentryConfig(bundleAnalyzer(nextConfig), {
  // Source-map upload runs only when SENTRY_AUTH_TOKEN is present, so
  // local builds and PR-preview builds (no token) skip the upload step
  // automatically. Production builds in Vercel pick it up from env.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
