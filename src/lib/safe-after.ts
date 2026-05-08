/**
 * Schedule work to run after the response is sent.
 *
 * Wraps `next/server`'s `after()` with a graceful fallback for
 * environments without a request scope:
 *
 *   - **Inside a route handler (production / dev / vercel build):**
 *     `after()` registers the task with the Next.js request lifecycle,
 *     which keeps the Fluid Compute function instance alive long
 *     enough for fire-and-forget work (email sends, audit writes,
 *     cache busts) to complete after the response ships.
 *
 *   - **Outside a request scope (vitest, ad-hoc scripts):** `after()`
 *     throws `next-dynamic-api-wrong-context`. We catch that and fall
 *     back to scheduling the task via `setImmediate` + an unhandled-
 *     rejection guard. The task still runs; it just doesn't have the
 *     Fluid-Compute keepalive guarantee — fine for tests, where the
 *     process keeps running until vitest tears down.
 *
 * Use this everywhere a route handler wants fire-and-forget semantics
 * for an awaitable side effect (email, telemetry, cache bust, audit
 * row). Don't reach for raw `void promise` — that drops the task on
 * Fluid-Compute teardown between requests.
 *
 * The callback is wrapped in try/catch so a thrown task error doesn't
 * surface as an unhandled rejection in production logs. Tasks that
 * need to surface their own failures should call `logSafeError`
 * inside their catch (the standard pattern).
 */

import { after } from "next/server";

export function safeAfter(task: () => Promise<unknown>): void {
  try {
    after(async () => {
      try {
        await task();
      } catch (err) {
        // Surface to stderr + Sentry without escalating to an
        // unhandled rejection. The Sentry mirror is in place because
        // safe-error-log.ts forwards there too.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logSafeError } = require("./safe-error-log") as {
          logSafeError: (label: string, err: unknown) => void;
        };
        logSafeError("safeAfter task failed", err);
      }
    });
  } catch {
    // No request scope (e.g. vitest). Fall back to setImmediate
    // fire-and-forget. The task still runs but without Fluid-Compute
    // keepalive — acceptable in tests + non-Next.js execution paths.
    setImmediate(() => {
      task().catch((err) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logSafeError } = require("./safe-error-log") as {
          logSafeError: (label: string, err: unknown) => void;
        };
        logSafeError("safeAfter (fallback) task failed", err);
      });
    });
  }
}
