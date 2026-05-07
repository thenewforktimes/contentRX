/**
 * Plan → monthly evaluation quota.
 *
 * Locked 2026-05-07 by _private/pricing-analysis.md (Phase 1 atomic
 * pricing PR). Empirical cost lands at $0.014–$0.015 per unit at the
 * cache rates Phase 0 measured across two runs. Full-utilization
 * margins are 64–69% across paid tiers, with room for a 25% Anthropic
 * price hike before any tier dips below 40%.
 *
 * Team's per-seat quota scales by seat count from the subscriptions
 * row. Scale is a flat pool: seat count does not multiply the cap.
 *
 * Schema 3.0.0 metering: 1 unit per 200 characters, rounded up. A
 * button label bills as 1 unit; a 1,000-character paragraph bills as
 * 5; a 4,000-character doc bills as 20.
 *
 * Above the cap: hard cap by default. Pro, Team, and Scale customers
 * can opt in to $0.10 per overage unit from /dashboard/settings/overage
 * (wired in Phase 4 of the post-pivot build). Free plans cannot opt
 * in to overage.
 */

export const QUOTAS = {
  free: 10,
  pro: 1_000,
  team: 2_000, // per seat, pooled across the team
  scale: 60_000, // pooled across the team (10-seat cap)
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
