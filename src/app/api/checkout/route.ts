/**
 * POST /api/checkout — create a Stripe Checkout Session for a paid plan.
 *
 * Body: {
 *   plan: "pro" | "team",
 *   interval: "monthly" | "annual",
 *   seats?: number,
 *   consentToken: string  // signed-nonce CARL consent token, minted at
 *                         // /dashboard render and bound to the user
 * }
 *
 * Team plans require seats >= TEAM_MIN_SEATS (1). Pro plans ignore seats
 * (quantity is always 1). The signed-in Clerk user is resolved to a
 * `users` row; if they already have a Stripe Customer ID it's reused so
 * a re-subscription after cancellation stays on the same customer record.
 *
 * The subscription's metadata gets `userId`, `plan`, `interval` — the
 * webhook reads these back to decide what to write into `users.plan` and
 * `subscriptions.seats`. Relying on `subscription_data.metadata` (not
 * session metadata) means the data follows the subscription forever,
 * including through Customer Portal plan changes.
 *
 * CARL compliance (ADR 2026-05-12). The consent claim is no longer a
 * trust-the-body boolean; it's a signed, single-use, time-bound token
 * minted server-side when /dashboard rendered SubscriptionPanel for
 * this user. /api/checkout verifies the token before stamping consent
 * — a forged body without a valid token returns 400 and never reaches
 * Stripe. The verified nonce is persisted on `users.auto_renewal_consent_nonce`
 * so a future dispute can audit-trail the consent moment back to a
 * specific UI render. See src/lib/consent-token.ts for the protocol.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { verifyConsentToken } from "@/lib/consent-token";
import { appUrl } from "@/lib/email";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  getStripe,
  priceIdFor,
  TEAM_MIN_SEATS,
  type Interval,
  type PaidPlan,
} from "@/lib/stripe";
import { sanitizeZodIssues } from "@/lib/zod-errors";

const RequestSchema = z.object({
  plan: z.enum(["pro", "team"]),
  interval: z.enum(["monthly", "annual"]),
  seats: z.number().int().min(1).max(500).optional(),
  // CARL (AB 2863, 2025-07-01) requires affirmative consent to
  // auto-renewal that is separate from ToS agreement. The body now
  // carries an HMAC-signed token (minted at /dashboard render for
  // this user, single-use, 15 minute TTL) rather than a plain
  // boolean. /api/checkout verifies the signature, time window,
  // user-binding, action, and nonce-replay state before stamping
  // consent. See src/lib/consent-token.ts.
  consentToken: z.string().min(20).max(2048),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const rl = await checkRateLimit(clerkId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: sanitizeZodIssues(parsed.error.issues) },
      { status: 400 },
    );
  }
  const { plan, interval } = parsed.data;

  const quantity = resolveQuantity(plan, parsed.data.seats);
  if (quantity === "invalid") {
    return NextResponse.json(
      {
        error: `Team plans require at least ${TEAM_MIN_SEATS} seats`,
      },
      { status: 400 },
    );
  }

  const priceId = priceIdFor(plan as PaidPlan, interval as Interval);
  if (!priceId) {
    return NextResponse.json(
      {
        error:
          "Pricing not configured for this plan/interval. Contact support.",
      },
      { status: 500 },
    );
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: "User not provisioned yet" },
      { status: 404 },
    );
  }

  // CARL: verify the signed-nonce consent token BEFORE creating the
  // Stripe Checkout Session. A failure here means the body claim
  // wasn't bound to a /dashboard render for this user — refuse the
  // request. Map structured failure reasons to customer-facing copy
  // that tells the customer how to recover.
  const consent = await verifyConsentToken({
    token: parsed.data.consentToken,
    expectedUserId: user.id,
    expectedAction: "auto-renewal",
  });
  if (!consent.ok) {
    const message =
      consent.reason === "expired"
        ? "Your session expired before checkout completed. Refresh the dashboard and try again."
        : consent.reason === "replayed"
          ? "This checkout attempt has already been processed. Refresh the dashboard to start a new one."
          : "Couldn't verify your consent. Refresh the dashboard and try again.";
    return NextResponse.json(
      { error: message, reason: consent.reason },
      { status: 400 },
    );
  }

  // Stamp the consent moment AND the verified nonce. The nonce is a
  // non-repudiation audit record — a future CARL dispute can be
  // traced to a specific /dashboard render event for this user.
  // Idempotent: a re-checkout (cancelled, came back) overwrites
  // with the new render's nonce. Retention: ≥3 years per CARL.
  await db
    .update(schema.users)
    .set({
      autoRenewalConsentedAt: new Date(),
      autoRenewalConsentNonce: consent.nonce,
    })
    .where(eq(schema.users.id, user.id));

  const stripe = getStripe();
  const baseUrl = appUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity }],
    customer: user.stripeCustomerId ?? undefined,
    // Only send customer_email when we don't already have a Stripe Customer
    // — Stripe rejects passing both. First-time checkout: no customer yet,
    // use the email. Re-upgrade after cancellation: we have the customer,
    // don't repeat the email.
    customer_email: user.stripeCustomerId ? undefined : user.email,
    client_reference_id: user.id,
    subscription_data: {
      metadata: {
        userId: user.id,
        plan,
        interval,
      },
    },
    allow_promotion_codes: true,
    success_url: `${baseUrl}/dashboard?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/dashboard`,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a session URL" },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: session.url });
}

function resolveQuantity(
  plan: "pro" | "team",
  seats: number | undefined,
): number | "invalid" {
  if (plan === "pro") return 1;
  const n = seats ?? TEAM_MIN_SEATS;
  if (n < TEAM_MIN_SEATS) return "invalid";
  return n;
}
