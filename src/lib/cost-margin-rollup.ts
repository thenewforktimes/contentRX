/**
 * Per-plan cost + margin rollup for the founder dashboard.
 *
 * Phase 2 of the post-Phase-1 build. The cost-monitor.ts module
 * already records per-call costs to `usage_events`; this module
 * aggregates by plan tier so the founder can answer "are we making
 * money on each plan?"  The page at /admin/costs/margin and the daily
 * cron at /api/cron/cost-margin-check both call into here.
 *
 * The cost number is a list-price estimate (Anthropic published rates
 * × logged tokens); accurate enough to spot a runaway plan-tier before
 * it costs real money. Cross-reference Anthropic billing for invoice
 * numbers.
 *
 * Revenue-per-unit assumptions are baked into PER_UNIT_REVENUE below
 * and must stay aligned with src/lib/quotas.ts (units) and the
 * /pricing page (dollars). When pricing changes, update this file in
 * the same PR. CI doesn't enforce this — the alignment is a human
 * call, kept honest by the comment.
 */

import { eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { QUOTAS, type Plan } from "./quotas";

/** Per-unit list-price revenue, USD. Aligned with src/lib/quotas.ts
 * and src/app/(marketing)/pricing/page.tsx as of 2026-05-07. */
const PER_UNIT_REVENUE: Record<Plan, number> = {
  free: 0,
  pro: 39 / QUOTAS.pro,
  team: 79 / QUOTAS.team, // per-seat economics — same per unit at any seat count
  scale: 1799 / QUOTAS.scale,
};

/** Plans we report margin for. Free is reported separately as a cost
 * line because it has no revenue and margin would divide by zero. */
const PAID_PLANS: ReadonlyArray<Plan> = ["pro", "team", "scale"];

export interface PlanRollup {
  plan: Plan;
  checkCount: number;
  totalCostUsd: number;
  totalUnits: number;
  avgCostPerUnitUsd: number;
  /** Cache hit ratio by token volume:
   * cache_read / (cache_read + cache_creation + input). */
  avgCacheHitRatio: number;
  /** Per-unit revenue for this plan; 0 for free. */
  perUnitRevenueUsd: number;
  /** Margin percent at the observed cost. Null for free (no revenue). */
  marginPct: number | null;
}

export interface CostMarginRollup {
  windowDays: number;
  plans: PlanRollup[];
  /** Number of users currently on cost-pause. The doc asked for
   * "7-day rolling activations" but we don't have an event log for
   * pause flips; this is the closest proxy without a schema change. */
  currentlyPausedCount: number;
}

export interface RollupOptions {
  /** Defaults to 7-day window per the doc. */
  windowDays?: number;
}

/**
 * Pull the per-plan cost/margin/cache rollup over the last N days.
 * Aggregates `usage_events` joined to `users` so free-plan activity is
 * captured (free users don't have a `subscriptions` row).
 *
 * Returns one row per plan that had at least one event in the window.
 * Plans with zero activity are not represented (the page renders an
 * empty-state for those).
 */
export async function getCostMarginRollup(
  opts: RollupOptions = {},
): Promise<CostMarginRollup> {
  const windowDays = opts.windowDays ?? 7;
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = (await db
    .select({
      plan: schema.users.plan,
      checkCount: sql<number>`count(*)::int`,
      totalCostUsd: sql<string>`coalesce(sum(${schema.usageEvents.estimatedCostUsd}), 0)`,
      totalUnits: sql<number>`coalesce(sum(${schema.usageEvents.unitsConsumed}), 0)::int`,
      totalInputTokens: sql<number>`coalesce(sum(${schema.usageEvents.inputTokens}), 0)::bigint`,
      totalCacheReadTokens: sql<number>`coalesce(sum(${schema.usageEvents.cacheReadInputTokens}), 0)::bigint`,
      totalCacheCreationTokens: sql<number>`coalesce(sum(${schema.usageEvents.cacheCreationInputTokens}), 0)::bigint`,
    })
    .from(schema.usageEvents)
    .innerJoin(schema.users, eq(schema.usageEvents.userId, schema.users.id))
    .where(gte(schema.usageEvents.createdAt, since))
    .groupBy(schema.users.plan)) as Array<{
      plan: Plan;
      checkCount: number;
      totalCostUsd: string;
      totalUnits: number;
      totalInputTokens: number | string;
      totalCacheReadTokens: number | string;
      totalCacheCreationTokens: number | string;
    }>;

  const plans: PlanRollup[] = rows.map((r) => {
    const totalCostUsd = parseFloat(r.totalCostUsd);
    const totalUnits = Number(r.totalUnits);
    const inputTokens = Number(r.totalInputTokens);
    const cacheReadTokens = Number(r.totalCacheReadTokens);
    const cacheCreationTokens = Number(r.totalCacheCreationTokens);
    const totalCacheableTokens =
      inputTokens + cacheReadTokens + cacheCreationTokens;
    const avgCacheHitRatio =
      totalCacheableTokens > 0 ? cacheReadTokens / totalCacheableTokens : 0;
    const avgCostPerUnitUsd = totalUnits > 0 ? totalCostUsd / totalUnits : 0;
    const perUnitRevenueUsd = PER_UNIT_REVENUE[r.plan];
    const marginPct =
      perUnitRevenueUsd > 0
        ? ((perUnitRevenueUsd - avgCostPerUnitUsd) / perUnitRevenueUsd) * 100
        : null;

    return {
      plan: r.plan,
      checkCount: r.checkCount,
      totalCostUsd,
      totalUnits,
      avgCostPerUnitUsd,
      avgCacheHitRatio,
      perUnitRevenueUsd,
      marginPct,
    };
  });

  const [{ pausedCount = 0 } = { pausedCount: 0 }] = (await db
    .select({ pausedCount: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(eq(schema.users.costPauseActive, true))) as Array<{
      pausedCount: number;
    }>;

  return {
    windowDays,
    plans,
    currentlyPausedCount: pausedCount,
  };
}

/**
 * Identify plans whose 7-day rolling margin is below the alert
 * threshold (default 30%). Used by the daily cron to decide whether
 * to fire a founder alert.
 *
 * Free plans never alert (no margin defined). Plans with no activity
 * never alert (avgCostPerUnitUsd is 0 and margin is 100%, which is
 * trivially fine).
 */
export function plansBelowMarginThreshold(
  rollup: CostMarginRollup,
  thresholdPct = 30,
): PlanRollup[] {
  return rollup.plans.filter((p) => {
    if (!PAID_PLANS.includes(p.plan)) return false;
    if (p.checkCount === 0) return false;
    return p.marginPct !== null && p.marginPct < thresholdPct;
  });
}
