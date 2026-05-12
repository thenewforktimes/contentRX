/**
 * POST /api/webhooks/stripe — Stripe webhook sink.
 *
 * Signature verification uses `stripe.webhooks.constructEvent` against
 * the raw request body; the STRIPE_WEBHOOK_SECRET env var must match
 * the endpoint's signing secret from the Stripe Dashboard.
 *
 * Idempotency: every Stripe handler in this file is idempotent —
 * `upsertSubscription` is a true upsert, status / plan / cancelledAt
 * updates are last-write-wins, and the side effects (welcome email,
 * upgrade analytics, payment-failed email) each carry their own
 * per-(userId, subscription | invoice) Redis dedupe. So Stripe's
 * retries are safe to run end-to-end; we don't need (and used to
 * have a buggy version of) a top-level event-id dedupe.
 *
 * The earlier top-level dedupe set the event-id key BEFORE running
 * any work. When a handler crashed mid-flight (DB outage, Stripe API
 * timeout), we returned 500 → Stripe retried → the retry saw the
 * key and short-circuited as `deduplicated: true` without re-running
 * the handler, silently dropping the upsert. Matches the same fix
 * the Clerk webhook landed on 2026-04-25.
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
import { revalidateSubscription } from "@/lib/cache-tags";
import { maybeGroupByDomain } from "@/lib/domain-grouping";
import { appUrl, sendEmail } from "@/lib/email";
import { monthlyQuota } from "@/lib/quotas";
import { getRedis } from "@/lib/redis";
import { requireEnv } from "@/lib/require-env";
import { logSafeError } from "@/lib/safe-error-log";
import {
  getStripe,
  isEntitled,
  planFromPriceId,
  type PaidPlan,
} from "@/lib/stripe";
import { PaymentFailedEmail } from "@/emails/payment-failed";
import { SubscriptionCancelledEmail } from "@/emails/subscription-cancelled";
import { SubscriptionConfirmationEmail } from "@/emails/subscription-confirmation";

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
  // Top-level boundary: any throw before an explicit response (missing
  // env var, Stripe SDK init failure, body-read crash) becomes a clean
  // JSON 500 instead of an HTML 500 with an empty content-type. The
  // 500 still lands in Sentry; only the response shape changes, so
  // operators (curl) and Stripe's retry logic both get something
  // parseable.
  try {
    return await handleStripeWebhook(req);
  } catch (err) {
    logSafeError("[stripe-webhook] handler unhandled error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function handleStripeWebhook(req: Request): Promise<Response> {
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
    logSafeError("[stripe-webhook] signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // No top-level event-id dedupe. Each handler's DB writes are
  // idempotent and the side effects (welcome email, upgrade
  // analytics, payment-failed email) carry their own per-action
  // Redis dedupe keys. The header comment block has the longer
  // rationale; the short version is that pre-claiming the event-id
  // key turned mid-handler crashes into silent permanent failures
  // on retry.

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
    logSafeError(`[stripe-webhook] handler failed for ${event.type}`, err);
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
  revalidateSubscription(userId);

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
    logSafeError("[stripe-webhook] post-checkout email/analytics failed", err);
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
    logSafeError("[stripe-webhook] upgrade analytics dedupe failed, tracking anyway", err);
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
  // Plan, seats, current_period_end may all have shifted — bust the
  // owner's subscription tag so /dashboard reflects the change on the
  // next render.
  revalidateSubscription(userId);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  const db = getDb();

  // Mark the subscription row canceled so the partial unique index on
  // active subscriptions stops blocking future upgrades. `cancelledAt`
  // is stamped for audit (it surfaces in /admin and downstream
  // reports). Per the 2026-05-10 cleanup there is no auto-retention
  // cron; customers initiate deletion themselves from
  // /dashboard/settings.
  await db
    .update(schema.subscriptions)
    .set({ status: "canceled", cancelledAt: new Date() })
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
    revalidateSubscription(userId);
    return;
  }

  await db
    .update(schema.users)
    .set({ plan: "free" })
    .where(eq(schema.users.id, userId));
  revalidateSubscription(userId);

  // Send the cancellation confirmation. Dedupe per (userId, subscription)
  // so Stripe replaying the deletion event doesn't fan out duplicate
  // emails. Per-action dedupe key matches the welcome-email + upgrade-
  // analytics patterns earlier in this file. Best-effort — a Resend
  // outage shouldn't 500 the webhook.
  try {
    const [cancelledUser] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (cancelledUser?.email) {
      const resolved = planFromPriceId(
        subscription.items.data[0]?.price.id ?? "",
      );
      const planLabel = resolved?.plan === "team" ? "Team" : "Pro";
      await sendEmail({
        to: cancelledUser.email,
        subject: `Your ContentRX ${planLabel} subscription is cancelled`,
        react: SubscriptionCancelledEmail({
          appUrl: appUrl(),
          planLabel,
        }),
        dedupeKey: `cancellation_email:${userId}:${subscription.id}`,
      });
    }
  } catch (err) {
    logSafeError("[stripe-webhook] post-cancel email failed", err);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // Stripe keeps the subscription active through the grace period
  // defined in Dashboard → Billing settings. We don't change the
  // plan here — Stripe's smart-retries do the work. We send a
  // single dunning email per invoice (dedupe by invoice.id) so
  // Stripe's three-week retry cadence doesn't spam the customer.
  //
  // Invoice schema can vary by API version; read subscription id
  // via the parent relationship when available. See
  // `InvoiceWithParent` type alias above for the documented field
  // shape.
  const parent = (invoice as unknown as InvoiceWithParent).parent;
  const subId = parent?.subscription;
  // Don't log invoice.customer_email — it's PII. The subscription id is
  // opaque and sufficient to correlate against subscriptions / users.
  console.warn(
    `invoice.payment_failed${subId ? ` subscription=${subId}` : ""}`,
  );

  if (!subId) {
    // No subscription on the invoice — likely a one-off or a Stripe
    // event shape we don't recognize. Nothing to send.
    return;
  }

  const db = getDb();
  const [row] = await db
    .select({
      userId: schema.subscriptions.userId,
      plan: schema.subscriptions.plan,
      seats: schema.subscriptions.seats,
      email: schema.users.email,
    })
    .from(schema.subscriptions)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.subscriptions.userId),
    )
    .where(eq(schema.subscriptions.stripeSubId, subId))
    .limit(1);

  if (!row) {
    // Subscription not yet upserted into our DB. Stripe will retry
    // the failed-payment webhook on the next retry cycle; if the
    // subscription lands by then, we'll send the email then.
    return;
  }

  const planLabel = row.plan === "team" ? `Team` : "Pro";

  try {
    await sendEmail({
      to: row.email,
      subject: `Your ContentRX payment didn't go through`,
      react: PaymentFailedEmail({
        appUrl: appUrl(),
        planLabel,
      }),
      // Dedupe on invoice.id so Stripe's retry attempts on the same
      // invoice don't fan out to multiple emails. Each retry fires
      // its own webhook, but the email lands once per invoice.
      dedupeKey: `payment_failed:${invoice.id ?? "no-id"}`,
    });
  } catch (err) {
    logSafeError("payment-failed email send", err);
  }
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

  // Stripe subscription events always carry a customer id in practice; bailing
  // here keeps an empty-string FK out of subscriptions.stripe_customer_id (the
  // column is NOT NULL, so the prior `?? ""` fallback was writing junk on the
  // theoretical no-customer path instead of failing loudly).
  if (!customerId) {
    console.warn(
      `subscription ${subscription.id} has no stripe customer id — skipping upsert`,
    );
    return;
  }

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
  await db
    .update(schema.users)
    .set({ stripeCustomerId: customerId })
    .where(eq(schema.users.id, userId));

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
        stripeCustomerId: customerId,
      })
      .where(eq(schema.subscriptions.id, existing.id));
  } else {
    // If another active row exists for this user, mark it canceled so
    // the partial unique index lets the new one land. Protects against
    // mid-migration weirdness where a previous sub's deletion event
    // hasn't arrived yet.
    if (entitled) {
      // Same `cancelledAt` stamp as handleSubscriptionDeleted so the
      // column reflects when the row was actually canceled, even
      // mid-migration.
      await db
        .update(schema.subscriptions)
        .set({ status: "canceled", cancelledAt: new Date() })
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
      stripeCustomerId: customerId,
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
      logSafeError(
        `[stripe-webhook] domain-grouping check failed for user ${userId}`,
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
