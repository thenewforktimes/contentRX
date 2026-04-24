/**
 * /dashboard/cadence/moment/[moment] — Weekly moment deep-review.
 *
 * Human-eval build plan Session 9. Each of the 13 moments gets a
 * deep-review slot once every 13 weeks (see `momentForWeek` in
 * src/lib/cadence.ts). The page surfaces:
 *
 *   - Override stream filtered to this moment over the last 30 days
 *   - The 10 most-overridden standards in this moment
 *   - Existing refinement-log entries touching this moment (pointer
 *     — content lives in the committed taxonomy_refinement_log.md)
 *
 * Graduation readiness per standard lands in Session 10; until then,
 * the "standards to watch" column shows override count and unique-
 * session count as proxy signals.
 */

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { MOMENT_ROTATION, momentForWeek } from "@/lib/cadence";

const WINDOW_DAYS = 30;

export default async function MomentReviewPage({
  params,
}: {
  params: Promise<{ moment: string }>;
}) {
  const { moment } = await params;
  if (!MOMENT_ROTATION.includes(moment)) {
    notFound();
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect(`/sign-in?redirect_url=/dashboard/cadence/moment/${moment}`);
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user || user.plan !== "team" || user.teamOwnerUserId !== null) {
    redirect("/dashboard/cadence");
  }

  const teamId = user.teamOwnerUserId ?? user.id;
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  const thisWeekMoment = momentForWeek(now);
  const isThisWeek = thisWeekMoment === moment;

  // Override stream for this moment.
  const overrides = (await db
    .select({
      id: schema.violationOverrides.id,
      standardId: schema.violationOverrides.standardId,
      overrideStance: schema.violationOverrides.overrideStance,
      overrideReasonCode: schema.violationOverrides.overrideReasonCode,
      createdAt: schema.violationOverrides.createdAt,
    })
    .from(schema.violationOverrides)
    .where(
      and(
        eq(schema.violationOverrides.teamId, teamId),
        eq(schema.violationOverrides.moment, moment),
        gte(schema.violationOverrides.createdAt, since),
      ),
    )
    .orderBy(desc(schema.violationOverrides.createdAt))
    .limit(50)) as Array<{
    id: string;
    standardId: string;
    overrideStance: string | null;
    overrideReasonCode: string | null;
    createdAt: Date;
  }>;

  // Top standards overridden in this moment.
  const topStandards = (await db
    .select({
      standardId: schema.violationOverrides.standardId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violationOverrides)
    .where(
      and(
        eq(schema.violationOverrides.teamId, teamId),
        eq(schema.violationOverrides.moment, moment),
        gte(schema.violationOverrides.createdAt, since),
      ),
    )
    .groupBy(schema.violationOverrides.standardId)
    .orderBy(desc(sql`count(*)`))
    .limit(10)) as Array<{ standardId: string; count: number }>;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Weekly deep-review · 60 minutes
        </p>
        <h1 className="mt-2 text-2xl font-semibold font-mono">{moment}</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {isThisWeek ? (
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-800 dark:text-amber-100">
              this week&apos;s moment
            </span>
          ) : (
            <>
              Out-of-rotation review. This week&apos;s moment is{" "}
              <Link
                href={`/dashboard/cadence/moment/${thisWeekMoment}`}
                className="font-mono text-xs underline underline-offset-2"
              >
                {thisWeekMoment}
              </Link>
              .
            </>
          )}
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Top-overridden standards · last {WINDOW_DAYS} days
        </h2>
        {topStandards.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
            No overrides in this moment over the last {WINDOW_DAYS} days.
            Either the moment is healthy or it hasn&apos;t seen traffic.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                <th className="py-2">Standard</th>
                <th className="py-2 text-right">Overrides</th>
              </tr>
            </thead>
            <tbody>
              {topStandards.map((s) => (
                <tr
                  key={s.standardId}
                  className="border-b border-neutral-100 dark:border-neutral-900"
                >
                  <td className="py-2 font-mono text-xs">{s.standardId}</td>
                  <td className="py-2 text-right">{s.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Override stream</h2>
        {overrides.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
            No individual overrides to review.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                <th className="py-2">Standard</th>
                <th className="py-2">Stance</th>
                <th className="py-2">Reason</th>
                <th className="py-2 text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-neutral-100 dark:border-neutral-900"
                >
                  <td className="py-2 font-mono text-xs">{r.standardId}</td>
                  <td className="py-2 text-xs">{r.overrideStance ?? "—"}</td>
                  <td className="py-2 text-xs">{r.overrideReasonCode ?? "—"}</td>
                  <td className="py-2 text-right text-xs text-neutral-600 dark:text-neutral-400">
                    {r.createdAt.toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <h2 className="text-sm font-semibold">Refinement-log pointers</h2>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          Existing refinement-log entries touching this moment live in{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
            taxonomy_refinement_log.md
          </code>
          . Grep the log for <code className="font-mono">{moment}</code> to
          see pending refinements. Session 8&apos;s{" "}
          <code className="font-mono">batch_summary.py draft-refinement</code>{" "}
          appends new candidates when a review batch flags a recurring
          standard override.
        </p>
      </section>

      <Link
        href="/dashboard/cadence"
        className="text-xs text-neutral-600 underline underline-offset-2 dark:text-neutral-400"
      >
        ← Back to daily queue
      </Link>
    </div>
  );
}
