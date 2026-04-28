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
