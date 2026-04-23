/**
 * Client-side Sentry init. Loaded once per page-view by Next.js when
 * NEXT_PUBLIC_SENTRY_DSN is set; no-op otherwise.
 */

import * as Sentry from "@sentry/nextjs";

// Browser-side noise we want to ignore for quota reasons. Some are
// benign (user aborted, network blipped), others are expected API
// errors we've already handled in the UI.
const BROWSER_IGNORE_ERRORS = [
  "AbortError",
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  // Browser extensions inject these; not our bugs.
  /^Non-Error promise rejection captured/,
  // Expected API error surfaces (we render them as UI, not "exceptions")
  /Rate limit exceeded/i,
  /Monthly quota exhausted/i,
];

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    // Lower than server (browser sessions are noisier; 5% is plenty for
    // perf insight without burning quota).
    tracesSampleRate: 0.05,
    replaysSessionSampleRate: 0,
    // Replay on errors only — capturing every session is privacy-heavy
    // and we don't need the storage cost.
    replaysOnErrorSampleRate: 0.1,
    sendDefaultPii: false,
    ignoreErrors: BROWSER_IGNORE_ERRORS,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
