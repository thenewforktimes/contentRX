import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Audit S6 — Content-Security-Policy + companion security headers.
//
// The connect/script/frame/img origins enumerate every third party we
// actually load in the browser: Clerk auth, Stripe Checkout + Customer
// Portal, Plausible analytics, Sentry browser SDK. Server-side calls
// (Anthropic, Resend, Postgres, Upstash) don't appear in CSP — they
// originate from the Vercel function, not the browser.
//
// `'unsafe-inline'` and `'unsafe-eval'` on script-src are needed for
// Next.js 15's hydration glue. Locking those down requires nonce-based
// middleware, deferred until post-launch.
//
// Skipped in development so HMR's eval-based fast refresh keeps working
// without the dev console getting drowned in CSP violation reports.
const cspDirectives: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "https://js.stripe.com",
    "https://plausible.io",
    "https://*.clerk.com",
    "https://*.clerk.accounts.dev",
    "https://challenges.cloudflare.com",
  ],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://img.clerk.com",
    "https://*.stripe.com",
  ],
  "font-src": ["'self'", "data:"],
  "connect-src": [
    "'self'",
    "https://api.stripe.com",
    "https://api.clerk.com",
    "https://*.clerk.com",
    "https://*.clerk.accounts.dev",
    "https://plausible.io",
    "https://*.ingest.sentry.io",
    "https://*.sentry.io",
  ],
  "frame-src": [
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://challenges.cloudflare.com",
    "https://*.clerk.com",
    "https://*.clerk.accounts.dev",
  ],
  "worker-src": ["'self'", "blob:"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
};

const csp = Object.entries(cspDirectives)
  .map(([k, v]) => `${k} ${v.join(" ")}`)
  .join("; ") + "; upgrade-insecure-requests";

const securityHeaders = [
  // CSP only in production — see comment above.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Content-Security-Policy", value: csp }]
    : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  // frame-ancestors in CSP supersedes X-Frame-Options on modern
  // browsers, but the legacy header still matters for IE/older Edge.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // Drop dead exports from barrel files at build time. Closes audit M-34.
  // Lucide and react-email expose deep barrel files; without this,
  // "import { X } from 'lucide-react'" pulls every icon into the bundle.
  // (Recharts was here pre-Pf7 — replaced by a hand-rolled SVG.)
  experimental: {
    optimizePackageImports: [
      "@react-email/components",
      "lucide-react",
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
