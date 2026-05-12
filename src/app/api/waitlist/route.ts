/**
 * POST /api/waitlist — capture a signup from a geo-blocked visitor.
 *
 * Triggered by the form on /waitlist. The visitor's country/region is
 * detected from Vercel edge headers (the same headers the middleware
 * uses to enforce the geo-block). The signup is delivered to the
 * founder as a Resend email, deduped per (email, day) so a form
 * double-submit doesn't generate two notifications.
 *
 * No DB write at launch — the expected signup volume is very low
 * (geo-blocked traffic that bothered to fill in the form), and adding
 * a waitlist_signups table is friction that's better deferred. When
 * volume justifies it, replace this endpoint with a proper Drizzle
 * write to a waitlist_signups table and add an /admin/waitlist
 * surface.
 *
 * No Clerk auth. The middleware explicitly bypasses /api/waitlist via
 * the always-allowed matcher so geo-blocked visitors can hit it.
 *
 * Rate limit posture for launch:
 *   - Dedupe by email-per-day blocks accidental flooding from one
 *     submitter.
 *   - No IP-based rate limit yet. If spam materializes, add an
 *     enforceWaitlistRateLimit(ip) check using a separate Upstash
 *     prefix (don't reuse ratelimit:check; the per-user budget there
 *     is unrelated).
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sendEmail, appUrl } from "@/lib/email";
import { logSafeError } from "@/lib/safe-error-log";
import { WaitlistSignupEmail } from "@/emails/waitlist-signup";

const RequestSchema = z.object({
  email: z.string().email().max(254),
  // Optional client-supplied region tag (the /waitlist page captures
  // the value from the redirect's `?region=` query param and posts it
  // back so the email shows the same region the visitor saw on
  // screen). Server falls back to the live geo headers if the client
  // omits this. Trimmed to 32 chars defensively.
  region: z.string().max(32).optional(),
});

function founderEmail(): string {
  return process.env.FOUNDER_EMAIL ?? "hello@contentrx.io";
}

function readGeoFromHeaders(req: Request): string {
  const country = req.headers.get("x-vercel-ip-country") ?? "";
  const region = req.headers.get("x-vercel-ip-country-region") ?? "";
  if (!country) return "";
  return region ? `${country}-${region}` : country;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { email, region: clientRegion } = parsed.data;
  const serverRegion = readGeoFromHeaders(req);
  const region = clientRegion || serverRegion || "";
  const userAgent = req.headers.get("user-agent") ?? "";
  const submittedAt = new Date().toISOString();

  // Dedupe per (email, day) so a form double-submit doesn't generate
  // two notifications. The Resend helper checks Redis for the key
  // before sending; on a duplicate, it returns { ok: true, deduplicated }
  // without firing the email.
  const day = submittedAt.slice(0, 10); // YYYY-MM-DD
  const dedupeKey = `waitlist:${email.toLowerCase()}:${day}`;

  try {
    const result = await sendEmail({
      to: founderEmail(),
      subject: `[WAITLIST] ${email} (${region || "unknown region"})`,
      react: WaitlistSignupEmail({
        email,
        region,
        userAgent,
        submittedAt,
      }),
      dedupeKey,
    });

    if (!result.ok) {
      logSafeError("[api/waitlist] founder notify failed", {
        message: result.error,
      });
      // We still return success to the visitor — the failure was
      // ContentRX-side and the user did nothing wrong. The founder
      // sees the log and the visitor doesn't see a confusing error
      // for a problem they can't fix.
    }

    return NextResponse.json({
      ok: true,
      message: "Got it. ContentRX will email you when access opens in your region.",
      _app_url: appUrl(),
    });
  } catch (err) {
    logSafeError("[api/waitlist] unexpected error", err);
    return NextResponse.json(
      { error: "Could not record signup. Try again in a few minutes." },
      { status: 500 },
    );
  }
}
