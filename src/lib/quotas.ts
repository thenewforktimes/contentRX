/**
 * Plan → monthly evaluation quota.
 *
 * Team quota scales by seat count from the subscriptions row.
 * Locked per BUILD_PLAN session 3.
 */

export const QUOTAS = {
  free: 25,
  pro: 5000,
  team: 5000, // per seat
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
