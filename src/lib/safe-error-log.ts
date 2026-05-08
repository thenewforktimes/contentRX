/**
 * Structured-error logger for routes that handle user content.
 *
 * Replaces `console.error("…", err)` patterns where `err` could
 * transitively carry the request body in its `.message`, its `.cause`
 * chain, or (for SDK errors) its serialised request payload. Vercel
 * captures stdout/stderr — anything we hand to `console.error` lands
 * in `vercel logs`. Hand-shaping the log line keeps user content out
 * of that channel.
 *
 * The shape we always log:
 *
 *   logSafeError("evaluate failed", err)
 *   ↓
 *   stderr: evaluate failed { kind: "ParseError", message: "…", status: 502 }
 *
 * - `kind`     — the constructor name (or `typeof err` for non-Error).
 *                Useful for categorising in log queries.
 * - `message`  — `err.message` truncated to 200 chars. Long enough
 *                to triage; short enough to make smuggling user
 *                content impractical.
 * - `status`   — present if the error carries an HTTP status (Stripe,
 *                Anthropic, fetch responses). Useful triage signal.
 *
 * Stack traces are intentionally NOT included by default. Most stack
 * traces don't carry user content, but library-specific frames
 * (Anthropic SDK, Stripe SDK) sometimes serialise the request body
 * into the frame's locals when the SDK constructs its own error
 * subclass. Opt in via `{ includeStack: true }` for cases where the
 * stack is the diagnostic value (e.g., a brand-new error type we
 * haven't seen before).
 *
 * Sentry mirroring: every server-side `logSafeError` call also fires
 * `Sentry.captureException(err)` so the error reaches the alerts
 * channel, not just `vercel logs`. The Sentry `beforeSend` scrub layer
 * (lib/sentry-scrub.ts, wired in instrumentation.ts) drops request
 * bodies, headers, cookies, query strings; truncates exception
 * messages; and redacts text-shaped extras / tags / breadcrumbs — so
 * the captured event keeps the same PII posture as the local log line.
 * The label argument lands as a Sentry tag for grouping.
 *
 * Failures inside the Sentry call are swallowed locally — Sentry can
 * be unreachable (DNS, init failure, vitest with no DSN) and that
 * must never propagate up to the caller's catch block.
 */

interface SafeLogOptions {
  /** Default false — opt in for unfamiliar errors where the stack
   * is the diagnostic value. The first 3 frames are included. */
  includeStack?: boolean;
}

const MESSAGE_MAX_CHARS = 200;
const STACK_MAX_FRAMES = 3;

function truncate(s: string | undefined): string | null {
  if (!s) return null;
  return s.length <= MESSAGE_MAX_CHARS
    ? s
    : `${s.slice(0, MESSAGE_MAX_CHARS)}…`;
}

interface SafeLogPayload {
  kind: string;
  message: string | null;
  status?: number;
  stack?: string;
}

function buildPayload(
  err: unknown,
  options: SafeLogOptions = {},
): SafeLogPayload {
  if (err instanceof Error) {
    const payload: SafeLogPayload = {
      kind: err.constructor.name,
      message: truncate(err.message),
    };
    // SDK errors (Anthropic, Stripe, fetch wrappers) often expose a
    // numeric status. When present, surface it — high-signal, low-PII.
    const status = (err as unknown as Record<string, unknown>).status;
    if (typeof status === "number") {
      payload.status = status;
    }
    if (options.includeStack && err.stack) {
      payload.stack = err.stack
        .split("\n")
        .slice(0, STACK_MAX_FRAMES)
        .join("\n");
    }
    return payload;
  }
  return {
    kind: typeof err,
    message: truncate(String(err)),
  };
}

/**
 * Log an error with user-content-safe shaping. Replaces
 * `console.error(label, err)`.
 *
 * Side-effects: writes a structured payload to stderr AND mirrors the
 * error to Sentry (via captureException) when running server-side. The
 * Sentry scrubber (lib/sentry-scrub.ts) ensures the captured event
 * carries the same PII posture as the local log line.
 *
 * @example
 *   try {
 *     await evaluate({ text });
 *   } catch (err) {
 *     logSafeError("evaluate failed", err);
 *     return json({ error: "Evaluation service unavailable" }, { status: 502 });
 *   }
 */
export function logSafeError(
  label: string,
  err: unknown,
  options: SafeLogOptions = {},
): void {
  console.error(label, buildPayload(err, options));
  forwardToSentry(label, err);
}

/**
 * Best-effort Sentry forward. Wrapped in try/catch because Sentry can
 * be unreachable (DNS failure, init error, vitest with no DSN) and a
 * failure in our error logger must never propagate up to the caller.
 *
 * The require() is intentional rather than import — Sentry's Next.js
 * SDK ships separate Node / Edge / Browser entry points, and the top-
 * level `import` form bundles all three into the route's worker. The
 * runtime require lets the module loader pick the runtime-appropriate
 * variant that instrumentation.ts already initialised.
 *
 * Tests typically don't init Sentry (no DSN), so captureException ends
 * up being a no-op — exactly what we want there.
 */
function forwardToSentry(label: string, err: unknown): void {
  // Sentry's Next.js SDK is a server-side concern. Skip the forward in
  // browser bundles where the dynamic import is wasteful.
  if (typeof window !== "undefined") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs") as {
      captureException?: (
        e: unknown,
        ctx?: { tags?: Record<string, string> },
      ) => void;
    };
    Sentry.captureException?.(err, { tags: { logSafeErrorLabel: label } });
  } catch {
    // Swallow — anything that fails here is strictly a logger problem,
    // not a caller problem. The stderr line above already landed.
  }
}
