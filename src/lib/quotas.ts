/**
 * Plan → monthly evaluation quota.
 *
 * Team quota scales by seat count from the subscriptions row.
 * Re-anchored 2026-04-30 alongside the pre-pilot launch (300-char
 * standard tier; document at 8 units flat; surface at 25 units flat —
 * see src/lib/metering.ts).
 *
 * Pricing rationale (per the 2026-04-30 launch pricing):
 *   - free:  20 checks lets a new user audit a couple of strings with
 *            margin for setup mistakes, without giving away enough to
 *            scan a whole product. Acquisition flywheel.
 *   - pro:   2,000 standard-equivalent checks at $39/month
 *            ($0.0195/check at the listed rate). Comfortable for
 *            sustained daily use AND burst months on standard checks.
 *            A document call costs 8 units; a surface call costs 25;
 *            a Pro user can comfortably mix ~250 standard + 50 document
 *            + 8 surface checks per month.
 *   - team:  5,000 standard-equivalents per seat, pooled across the
 *            team. Pooling matters because team usage isn't uniform —
 *            one designer scanning a release on the last week of the
 *            sprint hits 1,000+ on their own; pooling absorbs that
 *            without the admin re-licensing.
 *   - scale: 50,000 standard-equivalents pooled, flat $1,499/mo. 10
 *            seats max. For agencies running multiple clients and
 *            in-house design-system teams. Above 50,000 the customer
 *            is on the Enterprise sales motion.
 *
 * Revisit at 50 paying customers — see the strategy session notes for
 * the metrics that should drive any change (p50/p95 monthly usage,
 * month-over-month churn, time-to-quota).
 */

export const QUOTAS = {
  free: 20,
  pro: 2_000,
  team: 5_000, // per seat, pooled across the team
  scale: 50_000, // pooled across the team (10-seat cap)
} as const;

export type Plan = keyof typeof QUOTAS;

export function monthlyQuota(plan: Plan, seats = 1): number {
  if (plan === "team") return QUOTAS.team * Math.max(seats, 1);
  // Scale is a flat pool — seat count doesn't scale the cap.
  return QUOTAS[plan];
}

export function currentMonth(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthResetISO(date = new Date()): string {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return next.toISOString();
}
