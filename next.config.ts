import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Drop dead exports from barrel files at build time. Closes audit M-34.
  // Recharts/Lucide/react-email all expose deep barrel files; without
  // this, "import { Bar } from 'recharts'" pulls every chart kind into
  // the bundle.
  experimental: {
    optimizePackageImports: [
      "recharts",
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
};

export default withSentryConfig(nextConfig, {
  // Source-map upload runs only when SENTRY_AUTH_TOKEN is present, so
  // local builds and PR-preview builds (no token) skip the upload step
  // automatically. Production builds in Vercel pick it up from env.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
