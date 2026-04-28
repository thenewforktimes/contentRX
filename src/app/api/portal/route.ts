/**
 * POST /api/portal — create a Stripe Customer Portal session.
 *
 * The portal handles plan changes, payment method updates, invoice
 * history, and cancellation. Configure which of those are enabled in
 * Stripe Dashboard → Settings → Billing → Customer Portal.
 *
 * Requires the user to already have a Stripe Customer (set during
 * checkout). Users without one haven't paid yet — the dashboard's
 * Subscription panel shows the Upgrade flow for them instead.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { checkRateLimit } from "@/lib/ratelimit";
import { getStripe } from "@/lib/stripe";

export async function POST() {
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
  const portal = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appUrl()}/dashboard`,
  });

  return NextResponse.json({ url: portal.url });
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}
