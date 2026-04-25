/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Initializes Sentry on the Node and Edge runtimes. Sentry stays inert
 * if SENTRY_DSN isn't set, so dev / preview environments without the
 * env var don't pay any startup cost.
 */

import * as Sentry from "@sentry/nextjs";
import { validateRequiredEnvAtStartup } from "@/lib/require-env";

// Known-benign errors we don't want to fill the Sentry quota. These are
// network / abort patterns that happen during normal usage, not bugs:
//   - AbortError: user closes a browser tab mid-request
//   - ECONNRESET: transient network blip, upstream retry logic handles it
//   - 429 / 402: expected client errors we surface as typed responses,
//     not exceptions we need to investigate
const SENTRY_IGNORE_ERRORS = [
  "AbortError",
  "ECONNRESET",
  "ETIMEDOUT",
  /^Rate limit exceeded$/i,
  /^Monthly quota exhausted$/i,
];

export async function register() {
  // Fail loud at cold start in production if any required env var is
  // missing or empty — Vercel surfaces this as a deployment error
  // rather than letting individual handlers silently 5xx forever (the
  // CLERK_WEBHOOK_SECRET="" incident on 2026-04-24).
  if (process.env.NODE_ENV === "production") {
    validateRequiredEnvAtStartup();
  }

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  // Sample rate tuned low — Sentry free tier is 5k events/month and the
  // real signal we want is unhandled exceptions, not traces. 5% of
  // traces + 100% of errors keeps us well under quota for typical
  // traffic and still surfaces perf regressions.
  const commonConfig = {
    dsn,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    ignoreErrors: SENTRY_IGNORE_ERRORS,
  } as const;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init(commonConfig);
  } else if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(commonConfig);
  }
}

export const onRequestError = Sentry.captureRequestError;
