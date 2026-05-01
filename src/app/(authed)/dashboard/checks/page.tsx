/**
 * `/dashboard/checks` — customer-facing check history.
 *
 * Lists every check the user (or their team owner pivot) has run,
 * most-recent-first, with a textPreview of what was checked, the
 * verdict, the number of violations, the tier, and the source.
 * Searchable client-side via the ChecksSearch island.
 *
 * Data: reads from `usage_events`, which Phase 4 introduced for the
 * cost monitor and which gained content fields (verdict, violation
 * count, text preview) when this page shipped. One row per /api/check
 * call regardless of verdict, so passes show up alongside violations.
 *
 * Privacy: text_preview is a 80-char truncated copy of the user's
 * input, retained for the customer's own history view. Per ADR
 * 2026-04-28, the customer's own data shown back to the customer is
 * not aggregation or profiling. A future TTL will null text_preview
 * after 90 days.
 */

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, or, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import { humanizeVerdict } from "@/lib/humanize";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { ChecksSearch } from "./checks-search";

const PAGE_LIMIT = 100;

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

export default async function DashboardChecksPage() {
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

  const ownerId = user.teamOwnerUserId ?? user.id;
  const db = getDb();
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
      teamId: schema.usageEvents.teamId,
      userId: schema.usageEvents.userId,
    })
    .from(schema.usageEvents)
    .where(
      // Show the team's whole history when the user is on a team
      // (Team-plan teammates see their owner's checks alongside their
      // own — same scope as /dashboard/overrides). For Free / Pro /
      // Scale users, team_id is the user's own id (team-of-one).
      // Legacy rows where team_id is null fall back to user_id.
      or(
        eq(schema.usageEvents.teamId, ownerId),
        and(
          isNull(schema.usageEvents.teamId),
          eq(schema.usageEvents.userId, user.id),
        ),
      ),
    )
    .orderBy(desc(schema.usageEvents.createdAt))
    .limit(PAGE_LIMIT);

  const history: CheckHistoryRow[] = rows.map((r) => {
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
          className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        >
          ← Back to dashboard
        </Link>
        <Eyebrow>Check history</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold">Recent checks</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          The last {PAGE_LIMIT} checks your team has run, across every
          surface. Search the preview text or filter by verdict.
        </p>
      </header>

      {history.length === 0 ? (
        <section className="rounded-lg border border-stone-200 p-6 text-sm text-stone-600 dark:border-stone-800 dark:text-stone-300">
          No checks yet. Run one from the dashboard&apos;s{" "}
          <Link
            href="/dashboard"
            className="underline underline-offset-2"
          >
            Try a check
          </Link>{" "}
          panel and it&apos;ll appear here.
        </section>
      ) : (
        <ChecksSearch rows={history} />
      )}
    </div>
  );
}
