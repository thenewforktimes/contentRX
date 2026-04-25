/**
 * GET /api/team-analytics?range=7|30|90
 *
 * Team-scoped aggregations over the `violations` table. Every query is
 * filtered by `team_id = <owner-user-id>`, so a user can only see their
 * own team's data. Non-team-plan callers get an empty payload (not a
 * 403) so the dashboard can render a clean upsell without special
 * error handling.
 *
 * Scope for Session 17:
 *   - Panel 1: Usage this period (total violations in window + current
 *     month's evaluation count)
 *   - Panel 2: Top standards (violation counts grouped by standard_id)
 *   - Panel 3: Daily violations series for the window
 *   - Panel 5: Member activity (one row per distinct userId with a
 *     count of their violations)
 *
 * Deferred:
 *   - Panel 4 (Top files) — needs violations.file_path. The GitHub
 *     Action will populate it once Session 15's AST extractor lands.
 *     Until then the panel renders an empty state.
 */

import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { currentMonth } from "@/lib/quotas";
import { getDb, schema } from "@/db";

const SUPPORTED_RANGES = [7, 30, 90] as const;
type Range = (typeof SUPPORTED_RANGES)[number];

export async function GET(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.plan !== "team") {
    return NextResponse.json(
      envelope({
        plan: auth.plan,
        is_team: false,
        message: "Team analytics requires a Team plan.",
      }),
    );
  }

  // Admin-only per BUILD_PLAN §17 (closes BE-M-05 from the 2026-04-22
  // audit). Team members get 403; the page-level gate below mirrors
  // this so a member clicking "Open analytics" gets an explanation
  // instead of a blank JSON error.
  if (auth.teamOwnerUserId !== null) {
    return NextResponse.json(
      { error: "Team analytics is available to team owners only." },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const rawRange = Number(url.searchParams.get("range") ?? "30");
  const range: Range = SUPPORTED_RANGES.includes(rawRange as Range)
    ? (rawRange as Range)
    : 30;

  const teamId = auth.teamOwnerUserId ?? auth.user.id;
  const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000);

  const db = getDb();
  const month = currentMonth();

  // Closes audit H-18: was 6 sequential queries against the same
  // (team_id, created_at) window. Each was an independent SQL round-
  // trip → ~6×DB-RTT latency before TTFB. Now fan out in parallel.
  // The (collectTeamUserIds → usage sum) and (memberActivity → emails)
  // chains stay sequential within their own promises.

  const violationsCountP = (db
    .select({ violations_count: sql<number>`count(*)::int` })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamId),
        gte(schema.violations.createdAt, since),
      ),
    )
    .then((rows) => (rows as Array<{ violations_count: number }>)[0]?.violations_count ?? 0));

  // Panel 1 part 2 chain: team_user_ids → sum(usage.count) for current month.
  const evaluationsCountP = collectTeamUserIds(teamId).then(async (teamUserIds) => {
    if (teamUserIds.length === 0) return 0;
    const [{ total = 0 } = {}] = (await db
      .select({ total: sql<number>`coalesce(sum(${schema.usage.count}), 0)::int` })
      .from(schema.usage)
      .where(
        and(
          inArray(schema.usage.userId, teamUserIds),
          eq(schema.usage.month, month),
        ),
      )) as Array<{ total: number }>;
    return total;
  });

  // --- Panel 2: top standards in window ---
  const topStandardsP = db
    .select({
      standard_id: schema.violations.standardId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamId),
        gte(schema.violations.createdAt, since),
      ),
    )
    .groupBy(schema.violations.standardId)
    .orderBy(desc(sql`count(*)`))
    .limit(10) as unknown as Promise<Array<{ standard_id: string; count: number }>>;

  // --- Panel 3: daily violations series ---
  // date_trunc('day', created_at) in UTC so every day bucket has the
  // same length regardless of viewer's timezone. Dashboard re-formats
  // for display.
  const dailyP = db
    .select({
      day: sql<string>`date_trunc('day', ${schema.violations.createdAt})::date::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamId),
        gte(schema.violations.createdAt, since),
      ),
    )
    .groupBy(sql`date_trunc('day', ${schema.violations.createdAt})`)
    .orderBy(sql`date_trunc('day', ${schema.violations.createdAt})`) as unknown as Promise<
      Array<{ day: string; count: number }>
    >;

  // --- Panel 5 chain: per-member activity → email lookup ---
  const memberActivityP = (db
    .select({
      user_id: schema.violations.userId,
      violations: sql<number>`count(*)::int`,
    })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamId),
        gte(schema.violations.createdAt, since),
      ),
    )
    .groupBy(schema.violations.userId)
    .orderBy(desc(sql`count(*)`)) as unknown as Promise<Array<{ user_id: string; violations: number }>>)
    .then(async (rows) => {
      const emailByUserId = await loadEmails(rows.map((m) => m.user_id));
      return rows.map((row) => ({
        user_id: row.user_id,
        email: emailByUserId.get(row.user_id) ?? null,
        violations: row.violations,
      }));
    });

  // --- Panel 4: top files (populated once the GHA extractor passes
  // file_path through /api/check). Empty for plugin/CLI-only teams. ---
  const topFilesP = db
    .select({
      path: schema.violations.filePath,
      violations: sql<number>`count(*)::int`,
    })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamId),
        gte(schema.violations.createdAt, since),
        isNotNull(schema.violations.filePath),
      ),
    )
    .groupBy(schema.violations.filePath)
    .orderBy(desc(sql`count(*)`))
    .limit(10) as unknown as Promise<Array<{ path: string | null; violations: number }>>;

  const [
    violations_count,
    evaluations_count,
    topStandardsRaw,
    dailyRaw,
    memberActivity,
    topFilesRaw,
  ] = await Promise.all([
    violationsCountP,
    evaluationsCountP,
    topStandardsP,
    dailyP,
    memberActivityP,
    topFilesP,
  ]);

  // Fill in zero days so the chart doesn't skip empty periods.
  const daily = fillZeroDays(dailyRaw, since, range);

  const top_files = topFilesRaw
    .filter((r): r is { path: string; violations: number } => r.path !== null)
    .map((r) => ({ path: r.path, violations: r.violations }));

  return NextResponse.json(
    envelope({
      plan: auth.plan,
      is_team: true,
      range,
      range_start: since.toISOString(),
      generated_at: new Date().toISOString(),
      totals: {
        violations: violations_count,
        evaluations_month: evaluations_count,
        violation_rate:
          evaluations_count > 0
            ? Math.round((violations_count / evaluations_count) * 1000) / 10
            : null, // null → "insufficient data" in the UI
      },
      top_standards: topStandardsRaw,
      daily,
      member_activity: memberActivity,
      top_files,
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectTeamUserIds(ownerUserId: string): Promise<string[]> {
  const db = getDb();
  const members = (await db
    .select({ id: schema.teamMembers.memberUserId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamOwnerUserId, ownerUserId))) as Array<{
    id: string;
  }>;
  const ids = new Set<string>([ownerUserId, ...members.map((m) => m.id)]);
  return Array.from(ids);
}

async function loadEmails(
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const db = getDb();
  const rows = (await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds))) as Array<{
    id: string;
    email: string;
  }>;
  for (const r of rows) out.set(r.id, r.email);
  return out;
}

function fillZeroDays(
  rows: Array<{ day: string; count: number }>,
  since: Date,
  range: number,
): Array<{ day: string; count: number }> {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, r.count);

  const out: Array<{ day: string; count: number }> = [];
  const cursor = new Date(since);
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < range; i++) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ day: key, count: byDay.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
