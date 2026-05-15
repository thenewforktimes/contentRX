/**
 * POST /api/portal — create a Stripe Customer Portal session.
 *
 * The portal handles plan changes, payment method updates, invoice
 * history, and cancellation. Configure which of those are enabled in
 * Stripe Dashboard → Settings → Billing → Customer Portal.
 *
 * Optional JSON body `{ flow: "manage_seats" }` deep-links the owner
 * straight into the subscription-quantity (seat) update screen
 * instead of the portal home — used by the Members panel's
 * "Add a seat" CTA so a solo Team owner has a real path to invite a
 * teammate. Requires the Customer Portal config to allow subscription
 * quantity updates for the Team price (see
 * docs/stripe-portal-config-checklist.md). Falls back to the plain
 * portal session when no active subscription is found, so the CTA is
 * never a dead-end. The no-body call is unchanged (subscription
 * panel's "Manage subscription").
 *
 * Requires the user to already have a Stripe Customer (set during
 * checkout). Users without one haven't paid yet — the dashboard's
 * Subscription panel shows the Upgrade flow for them instead.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { appUrl } from "@/lib/email";
import { checkRateLimit } from "@/lib/ratelimit";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Optional body. subscription-panel calls this with no body/content-
  // type, so request.json() will throw — default to the plain portal.
  let manageSeats = false;
  try {
    const body = (await request.json()) as { flow?: unknown };
    manageSeats = body?.flow === "manage_seats";
  } catch {
    // No body — plain portal session (existing behavior).
  }

  const rl = await checkRateLimit(clerkId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 },
    );
  }

  const db = getDb();
  const [user] = await db
    .select({
      id: schema.users.id,
      stripeCustomerId: schema.users.stripeCustomerId,
    })
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: "User not provisioned yet" },
      { status: 404 },
    );
  }

  if (!user.stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing history yet. Upgrade to start a subscription." },
      { status: 409 },
    );
  }

  const stripe = getStripe();

  // Default: plain portal session (home screen).
  const params: Parameters<typeof stripe.billingPortal.sessions.create>[0] = {
    customer: user.stripeCustomerId,
    return_url: `${appUrl()}/dashboard`,
  };

  // Seat-management deep-link. We don't store the Stripe subscription
  // id, so resolve it live from the customer's active subscription.
  // If there's no active sub (e.g. founder-provisioned Scale, or a
  // lapsed customer), fall through to the plain portal rather than
  // erroring — the CTA must never be a dead-end.
  if (manageSeats) {
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "active",
      limit: 1,
    });
    const sub = subs.data[0];
    if (sub) {
      params.flow_data = {
        type: "subscription_update",
        subscription_update: { subscription: sub.id },
        after_completion: {
          type: "redirect",
          redirect: { return_url: `${appUrl()}/dashboard/members` },
        },
      };
    }
  }

  const portal = await stripe.billingPortal.sessions.create(params);

  return NextResponse.json({ url: portal.url });
}
