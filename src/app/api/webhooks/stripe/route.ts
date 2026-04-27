/**
 * POST /api/webhooks/stripe — Stripe webhook sink.
 *
 * Signature verification uses `stripe.webhooks.constructEvent` against
 * the raw request body; the STRIPE_WEBHOOK_SECRET env var must match
 * the endpoint's signing secret from the Stripe Dashboard.
 *
 * Idempotency: Stripe retries failed deliveries with the same `event.id`.
 * We SET NX into Redis with a 24h TTL before processing — if the key
 * already exists the event is a replay and we short-circuit with 200
 * so Stripe stops retrying. (Returning non-2xx would keep the retry
 * loop going against an already-applied change.)
 *
 * Handlers (locked per BUILD_PLAN §8):
 *   - checkout.session.completed       → link subscription, set plan
 *   - customer.subscription.updated    → plan/seats/period_end changes
 *   - customer.subscription.deleted    → downgrade to free
 *   - invoice.payment_failed           → log for now; email in Session 13
 */

import { and, eq, not } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb, schema } from "@/db";
import { trackEvent } from "@/lib/analytics";
import { maybeGroupByDomain } from "@/lib/domain-grouping";
import { appUrl, sendEmail } from "@/lib/email";
import { monthlyQuota } from "@/lib/quotas";
import { getRedis } from "@/lib/redis";
import { requireEnv } from "@/lib/require-env";
import {
  getStripe,
  isEntitled,
  planFromPriceId,
  type PaidPlan,
} from "@/lib/stripe";
import { SubscriptionConfirmationEmail } from "@/emails/subscription-confirmation";

const DEDUPE_PREFIX = "stripe_event:";
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Stripe SDK shapes that vary by API version. The `Stripe.Invoice` and
 * `Stripe.SubscriptionItem` types in the official package don't always
 * include these specific fields depending on which API version the
 * project pins. Reading them via a narrow named type means:
 *   - the field-name dependency is documented and discoverable;
 *   - if Stripe stabilizes the shape we can drop the alias and
 *     migrate to the SDK's built-in field name in one place;
 *   - `as` casts at the call sites become readable instead of
 *     `as unknown as { foo?: ... }` mystery casts.
 *
 * Both fields are read defensively at the call site (typeof guard /
 * optional chain) — these aliases ARE the runtime contract too, not
 * just type-level decoration.
 */
type InvoiceWithParent = {
  parent?: { subscription?: string };
};

type SubscriptionItemWithPeriodEnd = {
  current_period_end?: number;
};

export async function POST(req: Request) {
  // requireEnv throws on missing OR empty — Next.js catches → 500 + Sentry.
  // Same fix as the Clerk webhook (2026-04-24 incident).
  const secret = requireEnv("STRIPE_WEBHOOK_SECRET");

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      secret,
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Dedupe. If this event.id has already been processed, ACK the replay
  // so Stripe quiets down — don't re-apply the change.
  try {
    const redis = getRedis();
    const setResult = await redis.set(DEDUPE_PREFIX + event.id, "1", {
      nx: true,
      ex: DEDUPE_TTL_SECONDS,
    });
    if (setResult === null) {
      return NextResponse.json({ received: true, deduplicated: true });
    }
  } catch (err) {
    // Redis outage shouldn't block a valid webhook — log and proceed.
    // Worst case: we double-apply an event, which each handler is
    // written to tolerate (upserts, not inserts).
    console.error("Stripe dedupe lookup failed, proceeding without", err);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        // Silently ignore everything else — Stripe sends a lot of events
        // we didn't subscribe to at the endpoint level, and any noise
        // here just means the endpoint config isn't as tight as it
        // should be. Still 200 so Stripe stops retrying.
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook handler failed for ${event.type}`, err);
    // 500 → Stripe retries, which is what we want for transient failures
    // (DB glitch, Stripe API timeout mid-handler). For a permanent
    // failure the retry will exhaust and Stripe will log it.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // `client_reference_id` was set to our users.id when we created the
  // Checkout Session. If it's missing, this is a session we didn't
  // create — bail.
  const userId = session.client_reference_id;
  if (!userId) {
    console.warn("checkout.session.completed without client_reference_id");
    return;
  }

  // Defence-in-depth: confirm the claimed user actually exists before
  // writing subscription rows against their id. Prevents orphaned
  // subscription rows if a Stripe-dashboard-edited session ever targets
  // a deleted user (BE-M-06 from the 2026-04-22 audit).
  const db = getDb();
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) {
    console.warn(
      `checkout.session.completed: client_reference_id=${userId} is not a known user; skipping`,
    );
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!subscriptionId) {
    console.warn("checkout.session.completed without subscription");
    return;
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await upsertSubscription({ userId, subscription, customerId: customerId ?? null });

  // Welcome to paid: confirmation email + upgrade analytics. Best-effort —
  // a Resend or Plausible outage shouldn't 500 the webhook.
  //
  // Closes audit H-13: when the event-id dedupe at the top of POST() fails
  // open (Redis outage), every replay would re-send the welcome email and
  // re-fire the upgrade analytics. Each side-effect now has its own
  // per-(userId, subscription, side-effect) dedupe key so only the first
  // delivery actually emits.
  try {
    const [paidUser] = await getDb()
      .select({ email: schema.users.email, plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (paidUser?.email && (paidUser.plan === "pro" || paidUser.plan === "team")) {
      const seats = subscription.items.data[0]?.quantity ?? 1;
      const quota = monthlyQuota(paidUser.plan, seats);
      await Promise.allSettled([
        sendEmail({
          to: paidUser.email,
          subject:
            paidUser.plan === "team"
              ? "Welcome to ContentRX Team"
              : "Welcome to ContentRX Pro",
          react: SubscriptionConfirmationEmail({
            appUrl: appUrl(),
            plan: paidUser.plan,
            seats,
            quota,
          }),
          dedupeKey: `upgrade_email:${userId}:${subscription.id}`,
        }),
        trackUpgradeOnce({
          userId,
          subscriptionId: subscription.id,
          plan: paidUser.plan,
          seats,
        }),
      ]);
    }
  } catch (err) {
    console.warn("post-checkout email/analytics failed", err);
  }
}

/** trackEvent("upgrade") wrapped with Redis dedupe so a webhook replay
 * doesn't double-count an upgrade in Plausible. Closes audit H-13. */
async function trackUpgradeOnce(args: {
  userId: string;
  subscriptionId: string;
  plan: PaidPlan;
  seats: number;
}): Promise<void> {
  const key = `analytics:upgrade:${args.userId}:${args.subscriptionId}`;
  try {
    const redis = getRedis();
    const setResult = await redis.set(key, "1", {
      nx: true,
      ex: 30 * 24 * 60 * 60, // 30d — Stripe retries are bounded to days
    });
    if (setResult === null) return; // already counted
  } catch (err) {
    // Redis outage: fall through and track. Worst case = double-count.
    console.warn("upgrade analytics dedupe failed, tracking anyway", err);
  }
  await trackEvent("upgrade", {
    userId: args.userId,
    props: { plan: args.plan, seats: args.seats },
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.warn(
      `customer.subscription.updated ${subscription.id} had no userId metadata`,
    );
    return;
  }
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  await upsertSubscription({ userId, subscription, customerId });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  const db = getDb();

  // Mark the subscription row canceled so the partial unique index on
  // active subscriptions stops blocking future upgrades.
  await db
    .update(schema.subscriptions)
    .set({ status: "canceled" })
    .where(eq(schema.subscriptions.stripeSubId, subscription.id));

  if (!userId) return;

  // Closes audit H-14: don't blindly downgrade to free on every
  // subscription.deleted. A user mid-plan-switch (canceled team sub +
  // active pro sub from the same checkout) would otherwise lose access.
  // Only downgrade if no other entitled subscription remains.
  const [otherActive] = await db
    .select({ plan: schema.subscriptions.plan })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, userId),
        not(eq(schema.subscriptions.stripeSubId, subscription.id)),
        eq(schema.subscriptions.status, "active"),
      ),
    )
    .limit(1);

  if (otherActive) {
    // Another sub is still active — keep the user on that plan.
    await db
      .update(schema.users)
      .set({ plan: otherActive.plan })
      .where(eq(schema.users.id, userId));
    return;
  }

  await db
    .update(schema.users)
    .set({ plan: "free" })
    .where(eq(schema.users.id, userId));
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // Stripe keeps the subscription active through the grace period defined
  // in Dashboard → Billing settings. We don't change the plan here — we
  // just log. Session 13 wires Resend for the dunning email.
  // Invoice schema can vary by API version; read subscription id via
  // the parent relationship when available. See `InvoiceWithParent`
  // type alias above for the documented field shape.
  const parent = (invoice as unknown as InvoiceWithParent).parent;
  const subId = parent?.subscription;
  console.warn(
    `invoice.payment_failed${subId ? ` subscription=${subId}` : ""}${
      invoice.customer_email ? ` email=${invoice.customer_email}` : ""
    }`,
  );
}

// ---------------------------------------------------------------------------
// Shared upsert
// ---------------------------------------------------------------------------

async function upsertSubscription(args: {
  userId: string;
  subscription: Stripe.Subscription;
  customerId: string | null;
}) {
  const { userId, subscription, customerId } = args;
  const db = getDb();

  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  if (!priceId) {
    console.warn(`subscription ${subscription.id} has no price item`);
    return;
  }

  const resolved = planFromPriceId(priceId);
  // Metadata was set by our checkout route. Prefer it if present because
  // it's stable across price changes, fall back to reverse-lookup so
  // manual dashboard subscription adjustments still land sanely.
  const metaPlan = (subscription.metadata?.plan as PaidPlan | undefined) ?? null;
  const plan: PaidPlan | null = metaPlan ?? resolved?.plan ?? null;

  if (!plan) {
    console.warn(
      `subscription ${subscription.id} price ${priceId} not in our price map and no metadata — skipping`,
    );
    return;
  }

  const seats = item?.quantity ?? 1;
  const currentPeriodEnd = itemPeriodEnd(item) ?? null;
  const entitled = isEntitled(subscription.status);

  // Stripe Customer ID on the users row — set on first successful
  // checkout, preserved thereafter.
  if (customerId) {
    await db
      .update(schema.users)
      .set({ stripeCustomerId: customerId })
      .where(eq(schema.users.id, userId));
  }

  // Upsert the subscription row by stripe_sub_id (unique in schema).
  const [existing] = await db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.stripeSubId, subscription.id))
    .limit(1);

  if (existing) {
    await db
      .update(schema.subscriptions)
      .set({
        status: subscription.status,
        plan,
        seats,
        currentPeriodEnd,
        stripeCustomerId: customerId ?? "",
      })
      .where(eq(schema.subscriptions.id, existing.id));
  } else {
    // If another active row exists for this user, mark it canceled so
    // the partial unique index lets the new one land. Protects against
    // mid-migration weirdness where a previous sub's deletion event
    // hasn't arrived yet.
    if (entitled) {
      await db
        .update(schema.subscriptions)
        .set({ status: "canceled" })
        .where(
          and(
            eq(schema.subscriptions.userId, userId),
            eq(schema.subscriptions.status, "active"),
            not(eq(schema.subscriptions.stripeSubId, subscription.id)),
          ),
        );
    }

    await db.insert(schema.subscriptions).values({
      userId,
      stripeCustomerId: customerId ?? "",
      stripeSubId: subscription.id,
      status: subscription.status,
      plan,
      seats,
      currentPeriodEnd,
    });
  }

  // Apply plan to users row. When entitled → grant paid plan; when
  // status drops out of entitlement (past_due, unpaid, canceled) we
  // keep the user on their current paid plan until the
  // subscription.deleted event — Stripe's grace period handles dunning.
  if (entitled) {
    await db
      .update(schema.users)
      .set({ plan })
      .where(eq(schema.users.id, userId));

    // PR-21 — domain-based team grouping. When 3+ same-corporate-
    // domain users hit Pro/Scale, link them via domainGroupId + bump
    // every member's plan to "team" so the dashboard team UI
    // activates. Best-effort (a failure here doesn't roll the
    // subscription back); idempotent so a retry from Stripe re-runs
    // safely.
    try {
      await maybeGroupByDomain(userId);
    } catch (err) {
      console.warn(
        `domain-grouping check failed for user ${userId}`,
        err,
      );
    }
  }
}

function itemPeriodEnd(
  item: Stripe.SubscriptionItem | undefined,
): Date | null {
  if (!item) return null;
  // Different Stripe API versions keep the period on slightly different
  // shapes; read defensively via the documented type alias.
  const raw = (item as unknown as SubscriptionItemWithPeriodEnd)
    .current_period_end;
  if (typeof raw === "number") return new Date(raw * 1000);
  return null;
}
