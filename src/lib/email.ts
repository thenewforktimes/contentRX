/**
 * Resend client + transactional email helpers.
 *
 * Single boundary for outbound email — every send routes through here so
 * we can centralize the no-API-key dev fallback (log + no-op), the Redis
 * dedupe for once-per-month emails (quota warning + exhausted), and any
 * future template-render concerns.
 *
 * Templates live in `src/emails/` and are rendered by Resend itself when
 * we pass them as `react`. We never persist the rendered HTML.
 */

import { Resend } from "resend";
import type { ReactElement } from "react";
import { getRedis } from "./redis";
import { optionalEnv } from "./require-env";

const ONCE_PER_MONTH_TTL_SECONDS = 35 * 24 * 60 * 60;

let cached: Resend | null = null;

function client(): Resend | null {
  // optionalEnv treats RESEND_API_KEY="" the same as missing — so a
  // misconfigured prod env doesn't silently fall through to the dev
  // no-op path. (instrumentation.ts also requires this var in prod.)
  const key = optionalEnv("RESEND_API_KEY");
  if (!key) return null;
  if (!cached) cached = new Resend(key);
  return cached;
}

function fromAddress(): string {
  return optionalEnv("EMAIL_FROM") ?? "ContentRX <hello@contentrx.io>";
}

type SendArgs = {
  to: string;
  subject: string;
  react: ReactElement;
  /**
   * Idempotency key. When set, the send is dropped if the key already
   * exists in Redis. Use for emails that should fire at most once per
   * (user, month, type) — quota warning, quota exhausted.
   */
  dedupeKey?: string;
};

export async function sendEmail({
  to,
  subject,
  react,
  dedupeKey,
}: SendArgs): Promise<{ ok: boolean; deduplicated?: boolean; error?: string }> {
  if (dedupeKey) {
    try {
      const redis = getRedis();
      const setResult = await redis.set(`email:${dedupeKey}`, "1", {
        nx: true,
        ex: ONCE_PER_MONTH_TTL_SECONDS,
      });
      if (setResult === null) {
        return { ok: true, deduplicated: true };
      }
    } catch (err) {
      // Redis outage shouldn't block a transactional email — log and
      // proceed. Worst case: a duplicate send (the same dunning email
      // twice in a month), which is recoverable.
      console.warn("email dedupe lookup failed, sending anyway", err);
    }
  }

  const resend = client();
  if (!resend) {
    // Dev / preview environment without RESEND_API_KEY. Log so the
    // engineer can see what would have been sent and move on.
    console.info(`[email:dev] would send "${subject}" to ${to}`);
    return { ok: true };
  }

  try {
    await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      react,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown send error";
    console.error(`Resend send failed: ${message}`, err);
    return { ok: false, error: message };
  }
}

/**
 * Build the canonical app URL for use in email links. Falls back to
 * production if NEXT_PUBLIC_APP_URL isn't set, so dev/preview emails
 * never link to localhost.
 */
export function appUrl(): string {
  const raw = optionalEnv("NEXT_PUBLIC_APP_URL") ?? "https://contentrx.io";
  return raw.replace(/\/$/, "");
}
