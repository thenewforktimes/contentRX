/**
 * `/dashboard/checks` — customer-facing check history.
 *
 * Lists every check the user (or their team owner pivot) has run,
 * most-recent-first. Searchable server-side via ILIKE across the
 * preview text + content_type + moment + source fields, so a vague
 * memory of the original copy ("I think it went something like
 * 'The best place to sell collectibles'") finds matches across the
 * customer's entire history — not just the most-recent-100 client-
 * side window the page used to show.
 *
 * URL-driven state:
 *   - ?q=<text>        substring match
 *   - ?verdict=<one>   filter to a single verdict
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
  ilike,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import { humanizeVerdict } from "@/lib/humanize";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { ChecksSearch } from "./checks-search";

const PAGE_SIZE = 100;

interface CheckHistoryRow {
  id: string;
  createdAt: string;
  source: string | null;
  segmentType: "standard" | "document" | "surface";
  unitsConsumed: number;
  verdict: string | null;
  verdictLabel: string;
  violationCount: number;
  contentType: string | null;
  moment: string | null;
  textPreview: string | null;
}

interface PageProps {
  searchParams: Promise<{
    q?: string;
    verdict?: string;
    page?: string;
  }>;
}

const VALID_VERDICTS = new Set(["violation", "review_recommended", "pass"]);

export default async function DashboardChecksPage({ searchParams }: PageProps) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/checks");
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-stone-200 p-6 text-sm dark:border-stone-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 200);
  const verdictFilter = VALID_VERDICTS.has(params.verdict ?? "")
    ? (params.verdict as string)
    : "";
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
    })
    .from(schema.usageEvents)
    .where(and(...conditions))
    .orderBy(desc(schema.usageEvents.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasMore = rows.length > PAGE_SIZE;
  const visibleRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Counts per verdict for the filter pills. Scoped to the same
  // team scope but ignores the q + verdict filters so the pills always
  // show the totals (so a customer can see "10 findings, 4 worth a
  // look" while filtered to one). Cheap because of the team_created
  // index on usage_events.
  const verdictCountRows = await db
    .select({
      verdict: schema.usageEvents.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.usageEvents)
    .where(teamScopeClause)
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

  const history: CheckHistoryRow[] = visibleRows.map((r) => {
    const { label } = humanizeVerdict(
      r.verdict ?? "pass",
      r.violationCount ?? 0,
    );
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      source: r.source,
      segmentType: r.segmentType as "standard" | "document" | "surface",
      unitsConsumed: r.unitsConsumed,
      verdict: r.verdict,
      verdictLabel: label,
      violationCount: r.violationCount ?? 0,
      contentType: r.contentType,
      moment: r.moment,
      textPreview: r.textPreview,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dashboard"
          className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
        >
          ← Back to dashboard
        </Link>
        <Eyebrow>Check history</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold">Recent checks</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Search across every check your team has run. Try a phrase you
          remember writing. Even a few words will find it.
        </p>
      </header>

      {counts.all === 0 ? (
        <section className="rounded-lg border border-stone-200 p-6 text-sm text-stone-600 dark:border-stone-800 dark:text-stone-300">
          No checks yet. Run one from the dashboard&apos;s{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            Try a check
          </Link>{" "}
          panel and it&apos;ll appear here.
        </section>
      ) : (
        <ChecksSearch
          rows={history}
          query={q}
          verdict={verdictFilter}
          page={page}
          hasMore={hasMore}
          counts={counts}
        />
      )}
    </div>
  );
}

function clampPage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  // Defensive cap — 1000 pages × 100 = 100k checks, well past any
  // realistic team's volume. Anyone hitting this is misusing the
  // pagination URL.
  if (n > 1000) return 1000;
  return n;
}
