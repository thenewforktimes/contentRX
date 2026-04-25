/**
 * Stripe client + billing helpers.
 *
 * Price IDs live in env, not in code, so we can swap between test mode
 * and live mode without redeploying. The plan/interval combinations we
 * sell are locked in BUILD_PLAN §8:
 *
 *   - Pro Monthly:    $24/mo             (STRIPE_PRICE_PRO_MONTHLY)
 *   - Pro Annual:     $18/mo billed $216 (STRIPE_PRICE_PRO_ANNUAL)
 *   - Team Monthly:   $35/seat, 3-seat min (STRIPE_PRICE_TEAM_MONTHLY)
 *   - Team Annual:    $29/seat, 3-seat min (STRIPE_PRICE_TEAM_ANNUAL)
 *
 * Everything else (trial policy, promo codes, tax, proration rules) is
 * configured in the Stripe Dashboard — the app stays thin.
 */

import Stripe from "stripe";
import { optionalEnv, requireEnv } from "./require-env";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const secret = requireEnv("STRIPE_SECRET_KEY");
  _stripe = new Stripe(secret, {
    // Pin the API version so Stripe doesn't silently change response shapes
    // under us. Bump deliberately after reviewing migration notes.
    apiVersion: "2026-03-25.dahlia",
    typescript: true,
  });
  return _stripe;
}

export type PaidPlan = "pro" | "team";
export type Interval = "monthly" | "annual";

export const TEAM_MIN_SEATS = 3;

export function priceIdFor(plan: PaidPlan, interval: Interval): string | null {
  const key = (() => {
    if (plan === "pro" && interval === "monthly") return "STRIPE_PRICE_PRO_MONTHLY";
    if (plan === "pro" && interval === "annual") return "STRIPE_PRICE_PRO_ANNUAL";
    if (plan === "team" && interval === "monthly") return "STRIPE_PRICE_TEAM_MONTHLY";
    if (plan === "team" && interval === "annual") return "STRIPE_PRICE_TEAM_ANNUAL";
    return null;
  })();
  if (!key) return null;
  return optionalEnv(key) ?? null;
}

/**
 * Reverse map: given a Stripe price ID, figure out which plan/interval
 * we're on. Used in the webhook to decide what to write into the DB
 * without trusting Checkout Session metadata.
 */
export function planFromPriceId(
  priceId: string,
): { plan: PaidPlan; interval: Interval } | null {
  const table: Array<{
    env: string;
    plan: PaidPlan;
    interval: Interval;
  }> = [
    { env: "STRIPE_PRICE_PRO_MONTHLY", plan: "pro", interval: "monthly" },
    { env: "STRIPE_PRICE_PRO_ANNUAL", plan: "pro", interval: "annual" },
    { env: "STRIPE_PRICE_TEAM_MONTHLY", plan: "team", interval: "monthly" },
    { env: "STRIPE_PRICE_TEAM_ANNUAL", plan: "team", interval: "annual" },
  ];
  for (const row of table) {
    if (process.env[row.env] === priceId) {
      return { plan: row.plan, interval: row.interval };
    }
  }
  return null;
}

/**
 * Narrow Stripe's union-y subscription-status type to the lifecycle
 * values our user.plan logic cares about. "active" and "trialing" both
 * grant access; everything else (incomplete, past_due, canceled,
 * unpaid, paused) should NOT grant the paid plan.
 */
export function isEntitled(status: Stripe.Subscription.Status): boolean {
  return status === "active" || status === "trialing";
}
