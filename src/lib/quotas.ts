/**
 * Plan → monthly evaluation quota.
 *
 * Team quota scales by seat count from the subscriptions row.
 * Re-anchored 2026-04-28 alongside the proportional-billing rollout
 * (1 check = up to 3,000 characters, see src/app/api/check/route.ts).
 *
 * Pricing rationale (per the 2026-04-28 strategy session):
 *   - free:  20 checks lets a new user audit one full flow with margin
 *            for setup mistakes, without giving away enough to scan a
 *            whole product. Conversion-funnel sized.
 *   - pro:   1,000 checks at $29/month = $0.029/check. Comfortable for
 *            sustained daily use (~33/day) AND burst months. Tight
 *            enough that scanning a 1,500-string product in one month
 *            is just barely impossible — forces upgrade or multi-month
 *            spread, both of which are good for retention.
 *   - team:  1,000/seat shared pool. Same per-check economics as Pro;
 *            value-add is the shared pool + admin features, not a
 *            per-seat discount. Industry norm: per-seat is flat or
 *            higher for teams (Linear, Vercel, Slack), discounts only
 *            appear at enterprise scale via sales conversations.
 *
 * Revisit at 50 paying customers — see the strategy session notes for
 * the metrics that should drive any change (p50/p95 monthly usage,
 * month-over-month churn, time-to-quota).
 */

export const QUOTAS = {
  free: 20,
  pro: 1000,
  team: 1000, // per seat, pooled across the team
} as const;

export type Plan = keyof typeof QUOTAS;

export function monthlyQuota(plan: Plan, seats = 1): number {
  if (plan === "team") return QUOTAS.team * Math.max(seats, 1);
  return QUOTAS[plan];
}

export function currentMonth(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
