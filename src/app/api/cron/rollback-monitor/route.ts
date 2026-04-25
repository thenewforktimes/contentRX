/**
 * POST /api/cron/rollback-monitor — nightly auto-demotion monitor.
 *
 * Human-eval build plan Session 12. For every standard at
 * `batch_approval` or `autonomous`, compute the rolling 2-week
 * override rate (actor-weighted) and — when it meets or exceeds the
 * level's threshold — auto-demote one step. Re-graduation requires
 * re-earning all six Session 10 criteria; there is no fast-path.
 *
 * Thresholds (from `src/lib/graduation.ts`):
 *   autonomous      ≥ 5% → demote to batch_approval
 *   batch_approval  ≥ 10% → demote to robo_labels
 *
 * Denominator = `violations` rows in the window (engine flagged the
 * standard). Numerator = actor-weighted `violation_overrides`. The
 * minimum-denominator floor (10 violations / 14 days) suppresses
 * false demotions on low-traffic standards.
 *
 * Cron wiring (add when enabling):
 *   // vercel.json
 *   "crons": [
 *     { "path": "/api/cron/rollback-monitor", "schedule": "0 3 * * *" }
 *   ]
 * Nightly at 03:00 UTC.
 *
 * Auth: Vercel Cron passes `Authorization: Bearer <CRON_SECRET>`.
 * Missing / wrong secret → 401 / 503. No env-var bypass.
 */

import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  AUTO_DEMOTION_MIN_VIOLATIONS,
  AUTO_DEMOTION_WINDOW_DAYS,
  demoteOneStep,
  listGraduationStatuses,
  recordLevelChange,
  shouldAutoDemote,
  weightedOverrideCount,
  type GraduationLevel,
} from "@/lib/graduation";
import { requireEnv } from "@/lib/require-env";

const DAY_MS = 24 * 60 * 60 * 1000;

function requireCronAuth(req: Request): NextResponse | null {
  // requireEnv throws on missing OR empty CRON_SECRET → Next.js catches → 500.
  // The wrong-bearer case still returns 401 (auth failure, not config failure).
  const expected = requireEnv("CRON_SECRET");
  const got = req.headers.get("authorization");
  if (got !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const db = getDb();
  const windowStart = new Date(
    Date.now() - AUTO_DEMOTION_WINDOW_DAYS * DAY_MS,
  );

  const statuses = await listGraduationStatuses();
  const graduated = statuses.filter(
    (s) => s.level === "batch_approval" || s.level === "autonomous",
  );

  const results: Array<{
    standardId: string;
    level: GraduationLevel;
    rate: number | null;
    violations: number;
    overrides: number;
    demoted_to?: GraduationLevel;
    skipped_reason?: string;
  }> = [];

  for (const status of graduated) {
    const level = status.level as GraduationLevel;
    const standardId = status.standardId;

    // Denominator: violations rows (engine flagged the standard).
    const [{ violations_count = 0 } = { violations_count: 0 }] =
      (await db
        .select({ violations_count: sql<number>`count(*)::int` })
        .from(schema.violations)
        .where(
          and(
            eq(schema.violations.standardId, standardId),
            gte(schema.violations.createdAt, windowStart),
          ),
        )) as Array<{ violations_count: number }>;

    if (violations_count < AUTO_DEMOTION_MIN_VIOLATIONS) {
      results.push({
        standardId,
        level,
        rate: null,
        violations: violations_count,
        overrides: 0,
        skipped_reason: `insufficient denominator (<${AUTO_DEMOTION_MIN_VIOLATIONS} violations in ${AUTO_DEMOTION_WINDOW_DAYS}d)`,
      });
      continue;
    }

    // Numerator: actor-weighted override count.
    const overrideRows = (await db
      .select({
        actorRole: schema.violationOverrides.actorRole,
      })
      .from(schema.violationOverrides)
      .where(
        and(
          eq(schema.violationOverrides.standardId, standardId),
          gte(schema.violationOverrides.createdAt, windowStart),
        ),
      )) as Array<{ actorRole: string | null }>;
    const weighted = weightedOverrideCount(overrideRows);
    const rate = weighted / violations_count;

    if (!shouldAutoDemote(level, rate, violations_count)) {
      results.push({
        standardId,
        level,
        rate,
        violations: violations_count,
        overrides: overrideRows.length,
      });
      continue;
    }

    const newLevel = demoteOneStep(level);
    const reasonPct = (rate * 100).toFixed(1);
    const reason =
      `Auto-demoted: ${reasonPct}% override rate over the last ${AUTO_DEMOTION_WINDOW_DAYS} ` +
      `days (≥ ${(rate >= 0.10 ? 10 : 5)}% threshold for ${level}). ` +
      `${violations_count} violations / ${overrideRows.length} raw overrides ` +
      `(weighted ${weighted.toFixed(2)}). Re-graduation requires re-earning ` +
      `the full Session 10 criteria.`;

    await recordLevelChange({
      standardId,
      newLevel,
      reason,
      source: "auto_demotion",
    });

    results.push({
      standardId,
      level,
      rate,
      violations: violations_count,
      overrides: overrideRows.length,
      demoted_to: newLevel,
    });
  }

  return NextResponse.json({
    ok: true,
    window_days: AUTO_DEMOTION_WINDOW_DAYS,
    graduated_evaluated: graduated.length,
    demoted: results.filter((r) => r.demoted_to).length,
    results,
  });
}

// Allow a manual trigger via GET for dev and one-off re-runs.
export const GET = POST;
