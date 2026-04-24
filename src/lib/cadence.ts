/**
 * Review cadence helpers — human-eval build plan Session 9.
 *
 * Pure logic used by `/dashboard/cadence/*` surfaces and the weekly
 * digest email. No DB access — these functions take already-fetched
 * rows so they're trivial to unit-test. The server components that
 * render the dashboards handle the SQL.
 *
 * Three cadences:
 *
 *   Daily     — `/dashboard/cadence`
 *               Top-of-queue + urgent flags from the last 24h.
 *
 *   Weekly    — `/dashboard/cadence/moment/[moment]`
 *               One moment of the 13 gets the deep-review slot per
 *               week; rotation repeats every 13 weeks so every moment
 *               surfaces ~4x per year.
 *
 *   Monthly   — `/dashboard/cadence/calibration`
 *               Drift-check summary; pointer to the Session 7 tool.
 */

// ---------------------------------------------------------------------------
// Moment rotation (13-week cycle)
// ---------------------------------------------------------------------------

/**
 * Canonical moment ordering for the weekly rotation. Stable across
 * releases — reordering this would change which moment lands in a
 * given week, which matters for the "every moment every 13 weeks"
 * guarantee.
 *
 * Matches `MOMENT_TAXONOMY` in `src/content_checker/moments.py`.
 */
export const MOMENT_ROTATION: readonly string[] = [
  "first_encounter",
  "browsing_discovery",
  "decision_point",
  "task_execution",
  "confirmation",
  "celebration",
  "error_recovery",
  "destructive_action",
  "empty_state",
  "interruption",
  "trust_permission",
  "wayfinding",
  "compliance_disclosure",
] as const;

/**
 * ISO 8601 week number. Matches date-fns / luxon semantics: the week
 * containing the first Thursday of the year is week 1. Pure function;
 * no locale assumption.
 */
export function isoWeek(date: Date): number {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayOfWeek = d.getUTCDay() || 7; // Sunday → 7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const daysFromYearStart =
    (d.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000);
  return Math.ceil((daysFromYearStart + 1) / 7);
}

/**
 * ISO week key "YYYY-Www" — used for Redis dedupe on the weekly digest
 * email so re-running the cron never double-sends.
 */
export function weekKey(date: Date): string {
  const week = isoWeek(date);
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const isoYear = d.getUTCFullYear();
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Pick the moment for a given week. Every moment surfaces once per 13
 * weeks (~4x per year); ordering is stable across years so the
 * rotation doesn't drift when the year rolls over.
 */
export function momentForWeek(date: Date): string {
  // Offset by the year so January 2026 doesn't land on the same moment
  // as January 2027 if the calendar happens to line up — gives fresher
  // coverage across years.
  const yearOffset = date.getUTCFullYear() % MOMENT_ROTATION.length;
  const index = (isoWeek(date) + yearOffset) % MOMENT_ROTATION.length;
  return MOMENT_ROTATION[index]!;
}

// ---------------------------------------------------------------------------
// Urgent flags (daily surface)
// ---------------------------------------------------------------------------

export interface OverrideRowLite {
  standardId: string;
  moment: string | null;
  createdAt: Date | string;
  overrideStance: string | null;
}

export interface UrgentFlag {
  kind: "override_rate_spike" | "new_out_of_distribution_cluster";
  standardId?: string;
  moment?: string | null;
  currentCount: number;
  priorCount: number;
  deltaPct: number;
  message: string;
}

/**
 * Compare today's override stream to the preceding 7-day daily average
 * and surface standards whose override count has spiked.
 *
 * "Spike" threshold defaults to 3× the daily average (minimum absolute
 * count 3 to avoid noise on low-traffic teams).
 */
export function detectUrgentFlags(
  todayRows: OverrideRowLite[],
  priorSevenDayRows: OverrideRowLite[],
  options: { spikeMultiplier?: number; minAbsoluteCount?: number } = {},
): UrgentFlag[] {
  const spikeMultiplier = options.spikeMultiplier ?? 3;
  const minAbsoluteCount = options.minAbsoluteCount ?? 3;

  const today = new Map<string, number>();
  for (const r of todayRows) {
    today.set(r.standardId, (today.get(r.standardId) ?? 0) + 1);
  }
  const prior = new Map<string, number>();
  for (const r of priorSevenDayRows) {
    prior.set(r.standardId, (prior.get(r.standardId) ?? 0) + 1);
  }

  const flags: UrgentFlag[] = [];
  for (const [standardId, currentCount] of today) {
    if (currentCount < minAbsoluteCount) continue;
    const priorCount = prior.get(standardId) ?? 0;
    const priorDailyAverage = priorCount / 7;
    if (priorDailyAverage === 0) {
      // New standard in the override stream — always flag.
      flags.push({
        kind: "new_out_of_distribution_cluster",
        standardId,
        currentCount,
        priorCount,
        deltaPct: Infinity,
        message: `${currentCount} overrides on ${standardId} today — none in the prior 7 days. New override pattern.`,
      });
      continue;
    }
    const ratio = currentCount / priorDailyAverage;
    if (ratio >= spikeMultiplier) {
      const deltaPct = Math.round((ratio - 1) * 100);
      flags.push({
        kind: "override_rate_spike",
        standardId,
        currentCount,
        priorCount,
        deltaPct,
        message: `${standardId}: ${currentCount} overrides today vs ${priorDailyAverage.toFixed(1)}/day prior (+${deltaPct}%).`,
      });
    }
  }

  // Stable ordering: biggest spike first, then by standard_id.
  flags.sort((a, b) => b.deltaPct - a.deltaPct || a.standardId!.localeCompare(b.standardId!));
  return flags;
}

// ---------------------------------------------------------------------------
// Review velocity
// ---------------------------------------------------------------------------

export interface ReviewVelocityInput {
  /** Unix ms timestamps, one per completed review batch. */
  batchTimestamps: number[];
  /** Items reviewed in each batch, aligned with batchTimestamps. */
  batchSizes: number[];
  /** Total elapsed ms per batch. */
  batchDurationsMs: number[];
}

export interface VelocityMetrics {
  batchesCompleted: number;
  itemsReviewed: number;
  avgMsPerItem: number | null;
  avgBatchSize: number | null;
  /** Trend: items reviewed in the most recent half vs the older half. */
  itemsReviewedRecent: number;
  itemsReviewedPrior: number;
}

export function aggregateVelocity(input: ReviewVelocityInput): VelocityMetrics {
  const n = input.batchTimestamps.length;
  if (n === 0) {
    return {
      batchesCompleted: 0,
      itemsReviewed: 0,
      avgMsPerItem: null,
      avgBatchSize: null,
      itemsReviewedRecent: 0,
      itemsReviewedPrior: 0,
    };
  }

  const itemsReviewed = input.batchSizes.reduce((s, v) => s + v, 0);
  const totalMs = input.batchDurationsMs.reduce((s, v) => s + v, 0);
  const avgMsPerItem = itemsReviewed > 0 ? totalMs / itemsReviewed : null;
  const avgBatchSize = n > 0 ? itemsReviewed / n : null;

  // Split into recent / prior halves by timestamp order.
  const indices = input.batchTimestamps
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t - b.t)
    .map((o) => o.i);
  const mid = Math.floor(indices.length / 2);
  let recent = 0;
  let prior = 0;
  for (const [rank, idx] of indices.entries()) {
    if (rank < mid) prior += input.batchSizes[idx]!;
    else recent += input.batchSizes[idx]!;
  }

  return {
    batchesCompleted: n,
    itemsReviewed,
    avgMsPerItem,
    avgBatchSize,
    itemsReviewedRecent: recent,
    itemsReviewedPrior: prior,
  };
}

// ---------------------------------------------------------------------------
// Weekly digest payload
// ---------------------------------------------------------------------------

export interface StandardOverrideCount {
  standardId: string;
  moment: string | null;
  count: number;
}

export interface WeeklyDigestInput {
  weekStart: Date;
  teamLabel?: string;
  overridesThisWeek: OverrideRowLite[];
  overridesPriorWeek: OverrideRowLite[];
  topStandards: StandardOverrideCount[];
  pendingRefinementCount: number;
  nextMoment: string;
  dashboardUrl: string;
}

export interface WeeklyDigestPayload {
  weekLabel: string;
  totalOverridesThisWeek: number;
  totalOverridesPriorWeek: number;
  overrideDeltaPct: number | null;
  topStandards: StandardOverrideCount[];
  urgentFlags: UrgentFlag[];
  pendingRefinementCount: number;
  nextMoment: string;
  dashboardUrl: string;
}

export function buildWeeklyDigest(input: WeeklyDigestInput): WeeklyDigestPayload {
  const totalNow = input.overridesThisWeek.length;
  const totalPrior = input.overridesPriorWeek.length;
  const deltaPct =
    totalPrior === 0
      ? totalNow > 0
        ? null // can't express as a % when the denominator is zero
        : 0
      : Math.round(((totalNow - totalPrior) / totalPrior) * 100);

  // The weekly digest's urgent-flag surface uses the week-over-week
  // comparison rather than the daily one the dashboard uses — same
  // helper, different window.
  const flags = detectUrgentFlags(
    input.overridesThisWeek,
    // Treat prior week as "7 prior days" so the existing helper's
    // per-day math still works.
    input.overridesPriorWeek,
  );

  return {
    weekLabel: weekKey(input.weekStart),
    totalOverridesThisWeek: totalNow,
    totalOverridesPriorWeek: totalPrior,
    overrideDeltaPct: deltaPct,
    topStandards: input.topStandards.slice(0, 5),
    urgentFlags: flags.slice(0, 5),
    pendingRefinementCount: input.pendingRefinementCount,
    nextMoment: input.nextMoment,
    dashboardUrl: input.dashboardUrl,
  };
}
