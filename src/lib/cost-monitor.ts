/**
 * Per-call cost monitor.
 *
 * Phase 4 of the pre-pilot launch build. Two responsibilities:
 *
 *   1. Record per-call cost: every successful /api/check writes a row
 *      to `usage_events` capturing the segment type, billable units,
 *      raw token telemetry, and an estimated USD cost. Per-call
 *      granularity is required for daily-threshold rollups; the
 *      existing `usage` table is monthly-aggregate only.
 *   2. Evaluate thresholds and pause runaway accounts: after each
 *      write, sum the user's cost for today + this month against
 *      their daily/monthly thresholds. If either threshold is crossed,
 *      flip `users.cost_pause_active = true` so the next /api/check
 *      returns 402 until a founder clears the flag manually from
 *      `/admin/costs`.
 *
 * The thresholds are sized to catch *anomalies* (a forgotten loop, a
 * misconfigured CI job firing 10,000 checks an hour) — not to cap
 * normal heavy use. Defaults: $50/day, $500/month per user. Robo
 * lowers them per-pilot when a tighter cap is appropriate.
 *
 * The estimate is approximate (Anthropic list-price × token counts);
 * accurate enough to catch a runaway before it costs real money,
 * which is the cost monitor's single job.
 */

import { and, eq, gte, sql, sum } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { SizeClass } from "./metering";
import { estimateCostUsd } from "./pricing/model-rates";

export type CheckSource =
  | "dashboard"
  | "plugin"
  | "cli"
  | "action"
  | "ditto"
  | "lsp"
  | "mcp";

export interface RecordUsageEventArgs {
  userId: string;
  /** Schema 3.0.0: the three-tier model collapsed to length-routed
   * `SizeClass` ("small" / "large"). The DB column accepts the old
   * tier names for historical-row compat, but new rows write the new
   * size class. */
  segmentType: SizeClass;
  unitsConsumed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Anthropic model id when the engine reports it; null for short-
   * circuited paths (custom-example matches that bypass the LLM). */
  modelId?: string | null;
  // Check-history fields. Surfaced in /dashboard/checks. Population
  // is best-effort — a missing field falls back to null and the
  // history page handles it gracefully.
  teamId?: string | null;
  source?: CheckSource | null;
  contentType?: string | null;
  moment?: string | null;
  verdict?: string | null;
  reviewReason?: string | null;
  violationCount?: number;
  textHash?: string | null;
  textPreview?: string | null;
}

export interface ThresholdResult {
  /** True iff this call's evaluation flipped `cost_pause_active`
   * from false to true. The caller uses this to fire a single Resend
   * email per pause event. */
  pausedNow: boolean;
  /** True iff the user was already paused before this call's write.
   * Calls landing on an already-paused user shouldn't get here in
   * practice (the request would have 402'd at the pause middleware),
   * but the flag is included for instrumentation. */
  alreadyPaused: boolean;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyThresholdUsd: number;
  monthlyThresholdUsd: number;
}

/**
 * INSERT a row into `usage_events` with computed cost. Returns the
 * estimated cost so the caller can surface it (e.g. in a Resend email
 * body).
 */
export async function recordUsageEvent(
  args: RecordUsageEventArgs,
): Promise<{ estimatedCostUsd: number }> {
  const db = getDb();
  const cost = estimateCostUsd({
    modelId: args.modelId ?? null,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cacheReadInputTokens: args.cacheReadInputTokens,
    cacheCreationInputTokens: args.cacheCreationInputTokens,
  });
  await db.insert(schema.usageEvents).values({
    userId: args.userId,
    segmentType: args.segmentType,
    unitsConsumed: args.unitsConsumed,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cacheReadInputTokens: args.cacheReadInputTokens,
    cacheCreationInputTokens: args.cacheCreationInputTokens,
    modelId: args.modelId ?? null,
    estimatedCostUsd: cost.toFixed(6),
    teamId: args.teamId ?? null,
    source: args.source ?? null,
    contentType: args.contentType ?? null,
    moment: args.moment ?? null,
    verdict: args.verdict ?? null,
    reviewReason: args.reviewReason ?? null,
    violationCount: args.violationCount ?? 0,
    textHash: args.textHash ?? null,
    textPreview: args.textPreview ?? null,
  });
  return { estimatedCostUsd: cost };
}

/**
 * Read the user's current spend for today + this month, compare
 * against their thresholds, and flip `cost_pause_active = true` if
 * either is exceeded. Idempotent — calling twice in quick succession
 * after a threshold cross only fires `pausedNow: true` once.
 *
 * Uses UTC midnight as the "today" boundary so the calculation is
 * deterministic across server timezones. Threshold semantics:
 * `dailySpendUsd >= dailyThresholdUsd` means "you crossed it."
 */
export async function evaluateAndPauseIfExceeded(
  userId: string,
): Promise<ThresholdResult | null> {
  const db = getDb();
  const [user] = await db
    .select({
      daily: schema.users.dailyCostThresholdUsd,
      monthly: schema.users.monthlyCostThresholdUsd,
      paused: schema.users.costPauseActive,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return null;

  const dailyThresholdUsd = parseFloat(user.daily);
  const monthlyThresholdUsd = parseFloat(user.monthly);

  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  const [dailyRow] = await db
    .select({ total: sum(schema.usageEvents.estimatedCostUsd) })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.userId, userId),
        gte(schema.usageEvents.createdAt, todayStart),
      ),
    );
  const [monthlyRow] = await db
    .select({ total: sum(schema.usageEvents.estimatedCostUsd) })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.userId, userId),
        gte(schema.usageEvents.createdAt, monthStart),
      ),
    );

  const dailySpendUsd = parseFloat(dailyRow?.total ?? "0");
  const monthlySpendUsd = parseFloat(monthlyRow?.total ?? "0");

  const exceeded =
    dailySpendUsd >= dailyThresholdUsd ||
    monthlySpendUsd >= monthlyThresholdUsd;

  let pausedNow = false;
  if (exceeded && !user.paused) {
    // Atomic UPDATE with the WHERE guard ensures we only flip the
    // flag once even under concurrent threshold-crossings (e.g., two
    // calls landing in the same millisecond after the threshold).
    const result = await db
      .update(schema.users)
      .set({ costPauseActive: true })
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.costPauseActive, false),
        ),
      )
      .returning({ id: schema.users.id });
    pausedNow = result.length > 0;
  }

  return {
    pausedNow,
    alreadyPaused: user.paused,
    dailySpendUsd,
    monthlySpendUsd,
    dailyThresholdUsd,
    monthlyThresholdUsd,
  };
}

/** Quick read of the cost-pause flag. Called early in /api/check
 * before the engine. Returns false when the user can't be found
 * (defaults are permissive — auth would have already failed if the
 * user truly didn't exist). */
export async function checkCostPause(userId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ paused: schema.users.costPauseActive })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.paused ?? false;
}

/** Clear the cost-pause flag. Called by `/admin/costs`'s Resume
 * button. Returns whether the row was actually flipped (false means
 * the row was already not paused). */
export async function clearCostPause(userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(schema.users)
    .set({ costPauseActive: false })
    .where(
      and(
        eq(schema.users.id, userId),
        eq(schema.users.costPauseActive, true),
      ),
    )
    .returning({ id: schema.users.id });
  return result.length > 0;
}

/** Per-day spend rollup for /admin/costs. Returns rows sorted most-
 * recent-first across all users, since `start`. Used by the founder
 * dashboard's cost view; not on the request hot path. */
export async function dailyCostRollup(args: {
  start: Date;
}): Promise<
  Array<{
    userId: string;
    day: string;
    totalCostUsd: number;
    eventCount: number;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.usageEvents.userId,
      day: sql<string>`date_trunc('day', ${schema.usageEvents.createdAt})::date::text`,
      totalCostUsd: sum(schema.usageEvents.estimatedCostUsd),
      eventCount: sql<number>`count(*)::int`,
    })
    .from(schema.usageEvents)
    .where(gte(schema.usageEvents.createdAt, args.start))
    .groupBy(
      schema.usageEvents.userId,
      sql`date_trunc('day', ${schema.usageEvents.createdAt})`,
    )
    .orderBy(sql`date_trunc('day', ${schema.usageEvents.createdAt}) desc`);
  return rows.map((r) => ({
    userId: r.userId,
    day: r.day,
    totalCostUsd: parseFloat(r.totalCostUsd ?? "0"),
    eventCount: r.eventCount,
  }));
}
