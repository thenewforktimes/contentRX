/**
 * Stripe client + billing helpers.
 *
 * Price IDs live in env, not in code, so we can swap between test mode
 * and live mode without redeploying. The plan/interval combinations we
 * sell, anchored to the 2026-05-07 Phase 1 pricing lock
 * (_private/pricing-analysis.md):
 *
 *   - Pro Monthly:   $39/mo                       (STRIPE_PRICE_PRO_MONTHLY)
 *   - Pro Annual:    $379/yr (20% off)            (STRIPE_PRICE_PRO_ANNUAL)
 *   - Team Monthly:  $79/seat, no min             (STRIPE_PRICE_TEAM_MONTHLY)
 *   - Team Annual:   $759/seat/yr (20% off)       (STRIPE_PRICE_TEAM_ANNUAL)
 *   - Scale Monthly: $1,799/mo flat, 60k checks   (STRIPE_PRICE_SCALE_MONTHLY,
 *                                                   sales-assisted; no
 *                                                   self-serve checkout yet)
 *   - Scale Annual:  $17,299/yr (20% off)         (STRIPE_PRICE_SCALE_ANNUAL)
 *   - Overage:       $0.10/unit, metered          (STRIPE_PRICE_OVERAGE,
 *                                                   pre-created on every
 *                                                   paid sub for Phase 4)
 *
 * IMPORTANT: the env vars must point at price IDs anchored to the new
 * numbers above. The display copy in subscription-panel.tsx and
 * (marketing)/pricing/page.tsx already states the launch prices, and
 * Stripe must match. To update: create new prices in the Stripe
 * Dashboard at the launch numbers and update STRIPE_PRICE_*_MONTHLY /
 * _ANNUAL env vars in Vercel for production AND preview environments.
 *
 * Everything else (trial policy, promo codes, tax, proration rules) is
 * configured in the Stripe Dashboard. The app stays thin.
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
    apiVersion: "2026-04-22.dahlia",
    typescript: true,
  });
  return _stripe;
}

export type PaidPlan = "pro" | "team";
export type Interval = "monthly" | "annual";

// Re-export so existing server-side imports (`import { TEAM_MIN_SEATS }
// from "@/lib/stripe"`) keep working. The canonical definition lives
// in billing-constants.ts so client components can share it without
// pulling the Stripe SDK into the browser bundle.
export { TEAM_MIN_SEATS } from "./billing-constants";

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
