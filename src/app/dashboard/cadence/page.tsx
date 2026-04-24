/**
 * /dashboard/cadence — Daily 15-minute review landing.
 *
 * Human-eval build plan Session 9. Surfaces the top-of-queue (what
 * Robo should review first today), urgent flags from the last 24h
 * (override-rate spikes, new out-of-distribution clusters), and
 * pending refinement-log candidates.
 *
 * Team-plan gated the same way `/dashboard/overrides` is (Session 11
 * of BUILD_PLAN_v2). Non-team users land on an upsell card.
 */

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { detectUrgentFlags, momentForWeek } from "@/lib/cadence";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_OF_QUEUE_LIMIT = 10;

export default async function CadenceDailyPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/cadence");
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return (
      <section className="rounded-lg border border-neutral-200 p-6 text-sm dark:border-neutral-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  if (user.plan !== "team") {
    return <CadenceUpsellCard />;
  }

  const isAdmin = user.teamOwnerUserId === null;
  if (!isAdmin) {
    return <NonAdminNotice />;
  }

  const teamId = user.teamOwnerUserId ?? user.id;
  const now = new Date();
  const since24h = new Date(now.getTime() - DAY_MS);
  const sincePrior7d = new Date(now.getTime() - 8 * DAY_MS);

  // Top-of-queue: most recent overrides (MVP — the review queue service
  // from tools/review_queue.py ranks these more carefully; wiring that
  // into the dashboard is a follow-up).
  const topOfQueue = (await db
    .select({
      id: schema.violationOverrides.id,
      standardId: schema.violationOverrides.standardId,
      moment: schema.violationOverrides.moment,
      overrideStance: schema.violationOverrides.overrideStance,
      createdAt: schema.violationOverrides.createdAt,
    })
    .from(schema.violationOverrides)
    .where(eq(schema.violationOverrides.teamId, teamId))
    .orderBy(desc(schema.violationOverrides.createdAt))
    .limit(TOP_OF_QUEUE_LIMIT)) as Array<{
    id: string;
    standardId: string;
    moment: string | null;
    overrideStance: string | null;
    createdAt: Date;
  }>;

  // Urgent-flag windows: today vs prior 7 days.
  const todayRows = (await db
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
        gte(schema.violationOverrides.createdAt, since24h),
      ),
    )) as Array<{
    standardId: string;
    moment: string | null;
    createdAt: Date;
    overrideStance: string | null;
  }>;

  const priorRows = (await db
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
        gte(schema.violationOverrides.createdAt, sincePrior7d),
        sql`${schema.violationOverrides.createdAt} < ${since24h}`,
      ),
    )) as Array<{
    standardId: string;
    moment: string | null;
    createdAt: Date;
    overrideStance: string | null;
  }>;

  const flags = detectUrgentFlags(todayRows, priorRows);
  const thisWeekMoment = momentForWeek(now);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Daily review · 15 minutes
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Today&apos;s queue</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Top-of-queue overrides, urgent flags from the last 24h, and
          pointers to the weekly + monthly cadences. This week&apos;s deep-
          review slot:{" "}
          <Link
            href={`/dashboard/cadence/moment/${thisWeekMoment}`}
            className="font-mono text-xs underline underline-offset-2"
          >
            {thisWeekMoment}
          </Link>
          .
        </p>
      </header>

      <section className="grid grid-cols-3 gap-4 text-sm">
        <Stat label="Overrides today" value={todayRows.length.toString()} />
        <Stat label="Urgent flags" value={flags.length.toString()}
          tone={flags.length > 0 ? "warn" : "default"} />
        <Stat label="Top-of-queue depth" value={topOfQueue.length.toString()} />
      </section>

      {flags.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Urgent flags</h2>
          <ul className="flex flex-col gap-2">
            {flags.map((f, i) => (
              <li
                key={`${f.standardId}-${i}`}
                className="flex items-start justify-between gap-4 rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
              >
                <div>
                  <p className="font-mono text-xs">{f.standardId}</p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    {f.message}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                  {f.kind === "new_out_of_distribution_cluster" ? "new" : "spike"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Top of queue</h2>
        {topOfQueue.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
            No recent overrides. The queue catches up when team members
            override a violation in the Figma plugin or a PR comment.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                <th className="py-2">Standard</th>
                <th className="py-2">Moment</th>
                <th className="py-2">Stance</th>
                <th className="py-2 text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {topOfQueue.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-neutral-100 dark:border-neutral-900"
                >
                  <td className="py-2 font-mono text-xs">{r.standardId}</td>
                  <td className="py-2 text-xs text-neutral-600 dark:text-neutral-400">
                    {r.moment ?? "—"}
                  </td>
                  <td className="py-2 text-xs">{r.overrideStance ?? "—"}</td>
                  <td className="py-2 text-right text-xs text-neutral-600 dark:text-neutral-400">
                    {r.createdAt.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4 text-sm">
        <Link
          href={`/dashboard/cadence/moment/${thisWeekMoment}`}
          className="rounded-lg border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
        >
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Weekly · 60 min
          </p>
          <p className="mt-1 font-mono text-sm">{thisWeekMoment}</p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            Deep-review this week&apos;s moment.
          </p>
        </Link>
        <Link
          href="/dashboard/cadence/calibration"
          className="rounded-lg border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
        >
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Monthly · calibration
          </p>
          <p className="mt-1 font-mono text-sm">self-drift</p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            Last quarterly drift check + threshold regime.
          </p>
        </Link>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  const valueColor =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-300"
      : "text-neutral-900 dark:text-neutral-100";
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="text-xs uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

function CadenceUpsellCard() {
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
      <h1 className="text-lg font-semibold">Review cadence</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Daily / weekly / monthly review dashboards are a Team-plan
        feature. They surface override patterns across your team so you
        can catch rule drift early.
      </p>
      <Link
        href="/dashboard"
        className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-white dark:text-black"
      >
        Upgrade to Team
      </Link>
    </section>
  );
}

function NonAdminNotice() {
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
      <h1 className="text-lg font-semibold">Review cadence</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Only the team owner can view the review cadence. Ask your team
        owner to run through today&apos;s queue.
      </p>
      <Link
        href="/dashboard"
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Back to dashboard
      </Link>
    </section>
  );
}
