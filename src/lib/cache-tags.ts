/**
 * Dashboard cache-tag taxonomy + revalidate helpers (audit Pf3).
 *
 * Pre-Pf3 the dashboard busted every panel on every write: the
 * `revalidatePath("/dashboard", "layout")` call would invalidate
 * /dashboard, /dashboard/runs/*, /dashboard/overrides, /dashboard/team/*,
 * etc. — even when only the usage counter changed. With unstable_cache
 * tags + revalidateTag, each panel binds to one or two named tags and
 * only the affected tags get busted.
 *
 * Three tags scope the dashboard's cacheable reads:
 *
 *   `usage:user:${userId}`            — usage row for one user. Bust on
 *                                       /api/check (quota counter
 *                                       increments).
 *   `subscription:owner:${ownerId}`   — subscription rows for the team
 *                                       owner (Pro/Team plans). Bust on
 *                                       Stripe webhook + portal returns.
 *   `violations:team:${teamId}`       — every aggregate over violations
 *                                       and violation_overrides for a
 *                                       team. Bust on /api/check,
 *                                       /api/violations/override.
 *
 * "Owner" and "team" both resolve to teamOwnerUserId for team plan
 * users and to user.id for solo plan users — see lib/team-scope.ts.
 *
 * Why three rather than one-tag-per-loader? Loaders that read the
 * same underlying rows share a tag — there's no value busting them
 * separately, and we'd risk one write path forgetting to bust the
 * partner. The taxonomy follows the row source, not the loader.
 */

import { revalidateTag } from "next/cache";

export const tags = {
  usage: (userId: string) => `usage:user:${userId}`,
  subscription: (ownerId: string) => `subscription:owner:${ownerId}`,
  violations: (teamId: string) => `violations:team:${teamId}`,
};

/**
 * Best-effort revalidate. Wrapped in try/catch because revalidateTag
 * needs Next's static-generation-store context, which test harnesses
 * (vitest, pglite-driven integration tests) don't supply. A failure
 * shouldn't break the write request — the dashboard catches up on
 * the next natural refresh.
 */
function safeRevalidate(tag: string): void {
  try {
    revalidateTag(tag);
  } catch (err) {
    console.warn(`revalidateTag(${tag}) failed (non-fatal):`, err);
  }
}

export function revalidateUsage(userId: string): void {
  safeRevalidate(tags.usage(userId));
}

export function revalidateSubscription(ownerId: string): void {
  safeRevalidate(tags.subscription(ownerId));
}

export function revalidateViolations(teamId: string): void {
  safeRevalidate(tags.violations(teamId));
}

/**
 * Convenience for write paths that touch all three. /api/check is the
 * canonical caller — it increments usage, logs a violation, and runs
 * inside a team scope.
 */
export function revalidateAfterCheck(opts: {
  userId: string;
  teamId: string;
}): void {
  revalidateUsage(opts.userId);
  revalidateViolations(opts.teamId);
}
