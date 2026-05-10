/**
 * `/dashboard/checks` — customer-facing check history.
 *
 * Lists every check the user (or their team owner pivot) has run,
 * most-recent-first. Searchable server-side via ILIKE across the
 * preview text + content_type + moment + source fields.
 *
 * URL-driven state:
 *   - ?q=<text>        substring match
 *   - ?verdict=<one>   filter to a single verdict
 *   - ?source=<one>    filter to a single surface (dashboard|plugin|cli|action|lsp|mcp)
 *   - ?filter=flagged  scope to checks the signed-in user shared via Flag for Review
 *   - ?range=<one>     day | week | month | 30d | all  (named time-window)
 *   - ?from=<iso>      custom start (inclusive)
 *   - ?to=<iso>        custom end (exclusive)
 *   - ?page=<n>        1-indexed pagination
 *
 * Privacy: text_preview is the customer's own input, retained for
 * their own history view (per ADR 2026-04-28 — customer's own data
 * shown back to the customer is not aggregation or profiling).
 */

import { auth } from "@clerk/nextjs/server";
import {
  and,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import { humanizeVerdict } from "@/lib/humanize";
import { SURFACE_SOURCES, type SurfaceSource } from "@/lib/surfaces";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { ChecksSearch } from "./checks-search";

const PAGE_SIZE = 100;

export interface CheckHistoryRow {
  id: string;
  createdAt: string;
  source: string | null;
  segmentType: "small" | "large";
  unitsConsumed: number;
  verdict: string | null;
  verdictLabel: string;
  violationCount: number;
  contentType: string | null;
  moment: string | null;
  textPreview: string | null;
  textHash: string | null;
  /** True when the signed-in user has flagged this exact text via
   * Flag for Review (customer_flagged_reviews row exists for the
   * same user_id + text_hash). */
  flagged: boolean;
  /** When flagged, the customer_flagged_reviews.id so the row's
   * Revoke action can call DELETE /api/customer-flag/[id]. */
  flagId: string | null;
}

interface PageProps {
  searchParams: Promise<{
    q?: string;
    verdict?: string;
    source?: string;
    filter?: string;
    range?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

const VALID_VERDICTS = new Set(["violation", "review_recommended", "pass"]);
const SURFACE_SET = new Set<string>(SURFACE_SOURCES);

export type DateRange = "day" | "week" | "month" | "30d" | "all";
const RANGE_KEYS: DateRange[] = ["day", "week", "month", "30d", "all"];
const RANGE_DEFAULT: DateRange = "30d";

function rangeWindow(range: DateRange): { from: Date | null; to: Date | null } {
  const now = new Date();
  switch (range) {
    case "day": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: null };
    }
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { from: start, to: null };
    }
    case "month": {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      return { from: start, to: null };
    }
    case "30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { from: start, to: null };
    }
    case "all":
      return { from: null, to: null };
  }
}

export default async function DashboardChecksPage({ searchParams }: PageProps) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/checks");
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-line p-6 text-sm">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 200);
  const verdictFilter = VALID_VERDICTS.has(params.verdict ?? "")
    ? (params.verdict as string)
    : "";
  const sourceFilter = SURFACE_SET.has(params.source ?? "")
    ? (params.source as SurfaceSource)
    : "";
  const flaggedOnly = params.filter === "flagged";
  const range: DateRange =
    RANGE_KEYS.includes((params.range ?? "") as DateRange)
      ? (params.range as DateRange)
      : RANGE_DEFAULT;
  const customFrom = parseIsoDate(params.from);
  const customTo = parseIsoDate(params.to);
  const { from, to } =
    customFrom || customTo
      ? { from: customFrom, to: customTo }
      : rangeWindow(range);
  const page = clampPage(params.page);

  const ownerId = user.teamOwnerUserId ?? user.id;
  const db = getDb();

  // Team-scope clause: show the team's whole history when the user is
  // on a team. For Free/Pro/Scale (team-of-one), team_id == user.id.
  // Legacy rows where team_id is null fall back to user_id.
  const teamScopeClause = or(
    eq(schema.usageEvents.teamId, ownerId),
    and(
      isNull(schema.usageEvents.teamId),
      eq(schema.usageEvents.userId, user.id),
    ),
  );

  const conditions: SQL[] = [teamScopeClause as SQL];

  if (q.length > 0) {
    const pattern = `%${q}%`;
    const textMatch = or(
      ilike(schema.usageEvents.textPreview, pattern),
      ilike(schema.usageEvents.contentType, pattern),
      ilike(schema.usageEvents.moment, pattern),
      ilike(schema.usageEvents.source, pattern),
    );
    if (textMatch) conditions.push(textMatch);
  }

  if (verdictFilter) {
    conditions.push(eq(schema.usageEvents.verdict, verdictFilter));
  }

  if (sourceFilter) {
    conditions.push(eq(schema.usageEvents.source, sourceFilter));
  }

  if (from) {
    conditions.push(gte(schema.usageEvents.createdAt, from));
  }
  if (to) {
    conditions.push(lt(schema.usageEvents.createdAt, to));
  }

  if (flaggedOnly) {
    // Scope to checks the signed-in user has flagged. Matching is by
    // text_hash, not row id — the same string flagged multiple times
    // is one consent record. User-scoped (not team-scoped) per the
    // consent contract.
    conditions.push(
      exists(
        db
          .select({ one: sql<number>`1` })
          .from(schema.customerFlaggedReviews)
          .where(
            and(
              eq(schema.customerFlaggedReviews.userId, user.id),
              eq(
                schema.customerFlaggedReviews.textHash,
                schema.usageEvents.textHash,
              ),
            ),
          ),
      ),
    );
  }

  // Query LIMIT+1 to detect "there's a next page" without an exact count.
  const offset = (page - 1) * PAGE_SIZE;
  const rows = await db
    .select({
      id: schema.usageEvents.id,
      createdAt: schema.usageEvents.createdAt,
      source: schema.usageEvents.source,
      segmentType: schema.usageEvents.segmentType,
      unitsConsumed: schema.usageEvents.unitsConsumed,
      verdict: schema.usageEvents.verdict,
      reviewReason: schema.usageEvents.reviewReason,
      violationCount: schema.usageEvents.violationCount,
      contentType: schema.usageEvents.contentType,
      moment: schema.usageEvents.moment,
      textPreview: schema.usageEvents.textPreview,
      textHash: schema.usageEvents.textHash,
    })
    .from(schema.usageEvents)
    .where(and(...conditions))
    .orderBy(desc(schema.usageEvents.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasMore = rows.length > PAGE_SIZE;
  const visibleRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Pull the customer_flagged_reviews ids that match any visible row's
  // text_hash. One query (IN clause) regardless of row count. User-
  // scoped — only the signed-in user sees their own flag status.
  const visibleHashes = Array.from(
    new Set(
      visibleRows
        .map((r) => r.textHash)
        .filter((h): h is string => typeof h === "string" && h.length > 0),
    ),
  );
  const flagRows =
    visibleHashes.length > 0
      ? await db
          .select({
            id: schema.customerFlaggedReviews.id,
            textHash: schema.customerFlaggedReviews.textHash,
          })
          .from(schema.customerFlaggedReviews)
          .where(
            and(
              eq(schema.customerFlaggedReviews.userId, user.id),
              inArray(schema.customerFlaggedReviews.textHash, visibleHashes),
            ),
          )
      : [];
  const flagByHash = new Map<string, string>();
  for (const f of flagRows) {
    flagByHash.set(f.textHash, f.id);
  }

  // Counts for the filter pills. Scoped to team + time-window only —
  // ignores q + verdict + source + flagged so the pills always show
  // the totals within the chosen time window.
  const countConditions: SQL[] = [teamScopeClause as SQL];
  if (from) countConditions.push(gte(schema.usageEvents.createdAt, from));
  if (to) countConditions.push(lt(schema.usageEvents.createdAt, to));

  const verdictCountRows = await db
    .select({
      verdict: schema.usageEvents.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.usageEvents)
    .where(and(...countConditions))
    .groupBy(schema.usageEvents.verdict);

  const counts: Record<string, number> = {
    all: 0,
    violation: 0,
    review_recommended: 0,
    pass: 0,
  };
  for (const r of verdictCountRows) {
    const n = Number(r.count);
    counts.all += n;
    if (r.verdict && r.verdict in counts) counts[r.verdict] += n;
  }

  // Count of distinct flagged checks (user-scoped) within the window.
  // Powers the "Shared for review" pill count + the stats strip.
  const flaggedCountRows = await db
    .select({ count: sql<number>`count(distinct ${schema.customerFlaggedReviews.textHash})::int` })
    .from(schema.customerFlaggedReviews)
    .where(
      and(
        eq(schema.customerFlaggedReviews.userId, user.id),
        from
          ? gte(schema.customerFlaggedReviews.consentRecordedAt, from)
          : (sql`true` as SQL),
        to
          ? lt(schema.customerFlaggedReviews.consentRecordedAt, to)
          : (sql`true` as SQL),
      ),
    );
  const flaggedCount = Number(flaggedCountRows[0]?.count ?? 0);

  // Distinct surfaces in the window — drives the stats strip and the
  // source-filter dropdown's option list.
  const sourceRows = await db
    .selectDistinct({ source: schema.usageEvents.source })
    .from(schema.usageEvents)
    .where(and(...countConditions));
  const sourcesPresent: string[] = sourceRows
    .map((r) => r.source)
    .filter((s): s is NonNullable<typeof s> => s !== null && s.length > 0);

  const history: CheckHistoryRow[] = visibleRows.map((r) => {
    const { label } = humanizeVerdict(
      r.verdict ?? "pass",
      r.violationCount ?? 0,
    );
    const flagId = r.textHash ? flagByHash.get(r.textHash) ?? null : null;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      source: r.source,
      segmentType: (r.segmentType === "small" ? "small" : "large") as
        | "small"
        | "large",
      unitsConsumed: r.unitsConsumed,
      verdict: r.verdict,
      verdictLabel: label,
      violationCount: r.violationCount ?? 0,
      contentType: r.contentType,
      moment: r.moment,
      textPreview: r.textPreview,
      textHash: r.textHash,
      flagged: flagId !== null,
      flagId,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dashboard"
          className="text-xs text-quiet hover:text-strong"
        >
          ← Back to dashboard
        </Link>
        <Eyebrow>Check history</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold">Recent checks</h1>
        <p className="mt-1 text-sm text-default">
          Every check from every surface lands here. Filter by time
          window, verdict, or source. Flag any check for review with
          one click. The Flag CTA on a row is the same one that fires
          from the paste panel.
        </p>
      </header>

      <ChecksSearch
        rows={history}
        query={q}
        verdict={verdictFilter}
        source={sourceFilter}
        flaggedOnly={flaggedOnly}
        range={range}
        customFrom={customFrom ? customFrom.toISOString().slice(0, 10) : ""}
        customTo={customTo ? customTo.toISOString().slice(0, 10) : ""}
        page={page}
        hasMore={hasMore}
        counts={counts}
        flaggedCount={flaggedCount}
        sourcesPresent={sourcesPresent}
      />
    </div>
  );
}

function clampPage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  if (n > 1000) return 1000;
  return n;
}

function parseIsoDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  // Accept YYYY-MM-DD only. Anything richer (timestamps, timezones) is
  // out of scope for the date-picker UI.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
