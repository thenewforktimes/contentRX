/**
 * POST /api/checkout — create a Stripe Checkout Session for a paid plan.
 *
 * Body: { plan: "pro" | "team", interval: "monthly" | "annual", seats?: number }
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
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
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
  // California Automatic Renewal Law (CARL / AB 2863, 2025-07-01)
  // requires affirmative consent to auto-renewal that is separate
  // from agreement to the Terms of Service. The client sets this to
  // `true` only after the customer ticks the dedicated checkbox in
  // <SubscriptionPanel>. We refuse to create a Stripe Checkout
  // Session without it.
  autoRenewalConsented: z.literal(true),
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

  // CARL: stamp the auto-renewal consent timestamp before we create
  // the Stripe Checkout Session. Idempotent — if the user re-runs
  // checkout (cancelled, came back), the latest consent overwrites
  // the prior one. Retention: keep the row for ≥3 years per CARL.
  await db
    .update(schema.users)
    .set({ autoRenewalConsentedAt: new Date() })
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
