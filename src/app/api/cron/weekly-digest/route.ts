/**
 * POST /api/cron/weekly-digest — send the weekly review-cadence digest.
 *
 * Human-eval build plan Session 9. Intended for Vercel Cron:
 *
 *   // vercel.json (add when enabling)
 *   "crons": [
 *     { "path": "/api/cron/weekly-digest", "schedule": "0 14 * * 1" }
 *   ]
 *
 * Monday at 14:00 UTC. Iterates over team-plan admins, builds a
 * weekly digest payload for each, and sends through
 * `sendEmail()` with a `(user, week)` dedupe key so manual re-hits
 * never double-send.
 *
 * Auth:
 *   - Vercel Cron calls include `Authorization: Bearer <CRON_SECRET>`.
 *   - Manual runs can pass the same secret.
 *   - Missing / wrong secret → 401. No env-var bypass.
 */

import { NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buildWeeklyDigest, weekKey, momentForWeek } from "@/lib/cadence";
import { requireCronAuth } from "@/lib/cron-auth";
import { appUrl, sendEmail } from "@/lib/email";
import { WeeklyDigestEmail } from "@/emails/weekly-digest";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const db = getDb();
  const now = new Date();
  const currentWeekStart = new Date(now.getTime() - WEEK_MS);
  const priorWeekStart = new Date(now.getTime() - 2 * WEEK_MS);
  const nextMoment = momentForWeek(new Date(now.getTime() + WEEK_MS));

  // Team admins only. Team members land their overrides against the
  // owner's team_id, so the digest is scoped to the owner.
  const admins = (await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.plan, "team"),
        isNull(schema.users.teamOwnerUserId),
      ),
    )) as Array<{ id: string; email: string }>;

  const dashboardUrl = `${appUrl()}/dashboard/overrides`;

  const results: Array<{
    teamId: string;
    sent: boolean;
    deduplicated?: boolean;
    error?: string;
  }> = [];

  for (const admin of admins) {
    const teamId = admin.id;

    const thisWeek = (await db
      .select({
        standardId: schema.violationOverrides.standardId,
        moment: schema.violationOverrides.moment,
        createdAt: schema.violationOverrides.createdAt,
        overrideStance: schema.violationOverrides.overrideStance,
      })
      .from(schema.violationOverrides)
      .where(
        and(
          eq(schema.violationOverrides.teamId, teamId),
          gte(schema.violationOverrides.createdAt, currentWeekStart),
        ),
      )) as Array<{
      standardId: string;
      moment: string | null;
      createdAt: Date;
      overrideStance: string | null;
    }>;

    const priorWeek = (await db
      .select({
        standardId: schema.violationOverrides.standardId,
        moment: schema.violationOverrides.moment,
        createdAt: schema.violationOverrides.createdAt,
        overrideStance: schema.violationOverrides.overrideStance,
      })
      .from(schema.violationOverrides)
      .where(
        and(
          eq(schema.violationOverrides.teamId, teamId),
          gte(schema.violationOverrides.createdAt, priorWeekStart),
          lt(schema.violationOverrides.createdAt, currentWeekStart),
        ),
      )) as Array<{
      standardId: string;
      moment: string | null;
      createdAt: Date;
      overrideStance: string | null;
    }>;

    const topStandards = (await db
      .select({
        standardId: schema.violationOverrides.standardId,
        moment: schema.violationOverrides.moment,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.violationOverrides)
      .where(
        and(
          eq(schema.violationOverrides.teamId, teamId),
          gte(schema.violationOverrides.createdAt, currentWeekStart),
        ),
      )
      .groupBy(
        schema.violationOverrides.standardId,
        schema.violationOverrides.moment,
      )
      .orderBy(desc(sql`count(*)`))
      .limit(5)) as Array<{
      standardId: string;
      moment: string | null;
      count: number;
    }>;

    const payload = buildWeeklyDigest({
      weekStart: currentWeekStart,
      overridesThisWeek: thisWeek,
      overridesPriorWeek: priorWeek,
      topStandards,
      pendingRefinementCount: 0, // Session 34 will count these from the log.
      nextMoment,
      dashboardUrl,
    });

    // Skip empty weeks so admins aren't spammed when nothing happened.
    if (
      payload.totalOverridesThisWeek === 0
      && payload.urgentFlags.length === 0
      && payload.topStandards.length === 0
    ) {
      results.push({ teamId, sent: false, deduplicated: false });
      continue;
    }

    const dedupeKey = `weekly-digest:${teamId}:${weekKey(currentWeekStart)}`;
    const res = await sendEmail({
      to: admin.email,
      subject: `ContentRX review digest · ${payload.weekLabel}`,
      react: WeeklyDigestEmail({ payload }),
      dedupeKey,
    });
    results.push({
      teamId,
      sent: res.ok && !res.deduplicated,
      deduplicated: res.deduplicated,
      error: res.error,
    });
  }

  const sent = results.filter((r) => r.sent).length;
  const dedup = results.filter((r) => r.deduplicated).length;
  const skipped = results.length - sent - dedup;

  return NextResponse.json({
    ok: true,
    week: weekKey(currentWeekStart),
    admins: admins.length,
    sent,
    deduplicated: dedup,
    skipped,
    results,
  });
}

// Allow manual trigger via GET for local testing with curl.
export const GET = POST;
