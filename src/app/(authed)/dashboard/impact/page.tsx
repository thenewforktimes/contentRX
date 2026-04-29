/**
 * /dashboard/impact — your contribution to the ContentRX model.
 *
 * Block 4 (polish) of the calibration plan. Shows the customer
 * how their copies + rewrites + custom rules have shaped the
 * model. Counts only — substrate boundary preserved (ADR
 * 2026-04-25); the customer never sees the precedent corpus
 * itself, just their own footprint.
 *
 * Auth: Clerk session via the (authed) layout. Server Component;
 * reads directly from the DB.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import { getOrProvisionUser } from "@/lib/user-provisioning";

export const metadata = {
  title: "Your impact · ContentRX",
};

export default async function ImpactPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/impact");
  }
  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-stone-200 p-6 text-sm dark:border-stone-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const db = getDb();

  // Per-source counts of this user's calibration signals.
  // suggestion_candidates is the unified candidates table; the
  // source enum distinguishes copy from rewrite from team_rule.
  const [signalCounts] = await db
    .select({
      copies: sql<number>`count(*) FILTER (WHERE ${schema.suggestionCandidates.source} = 'customer_copy')::int`,
      rewrites: sql<number>`count(*) FILTER (WHERE ${schema.suggestionCandidates.source} = 'customer_rewrite')::int`,
    })
    .from(schema.suggestionCandidates)
    .where(eq(schema.suggestionCandidates.sourceUserId, user.id));

  // How many of this user's candidates have been promoted to
  // precedents — the "your work shaped the model" headline. Joins
  // suggestion_precedents.source_candidate_id back to
  // suggestion_candidates.source_user_id.
  const [{ approvedCount }] = await db
    .select({
      approvedCount: sql<number>`count(*)::int`,
    })
    .from(schema.suggestionPrecedents)
    .innerJoin(
      schema.suggestionCandidates,
      eq(
        schema.suggestionPrecedents.sourceCandidateId,
        schema.suggestionCandidates.id,
      ),
    )
    .where(eq(schema.suggestionCandidates.sourceUserId, user.id));

  // Team rules this user created (if they're on the Team plan).
  // Scopes to source_team_owner_user_id since the user might be
  // a team member rather than the owner.
  const teamOwnerUserId = user.teamOwnerUserId ?? user.id;
  const [{ ruleCount }] = await db
    .select({
      ruleCount: sql<number>`count(*)::int`,
    })
    .from(schema.teamCustomExamples)
    .where(
      and(
        eq(schema.teamCustomExamples.teamOwnerUserId, teamOwnerUserId),
        eq(schema.teamCustomExamples.createdByUserId, user.id),
      ),
    );

  const totalSignals =
    Number(signalCounts.copies) +
    Number(signalCounts.rewrites) +
    Number(ruleCount);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow>Your impact</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold">
          {totalSignals === 0
            ? "Your contributions shape the model"
            : totalSignals === 1
              ? "1 signal you've shared"
              : `${totalSignals.toLocaleString()} signals you've shared`}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-stone-600 dark:text-stone-300">
          Every time you copy a suggestion, write a better rewrite, or
          add a rule for your team, ContentRX gets a calibration
          signal. Approved rewrites become precedents the model reads
          on every check.{" "}
          <Link
            href="/about"
            className="underline underline-offset-2"
          >
            How the model learns
          </Link>
          .
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ImpactStat
          label="Suggestions copied"
          count={Number(signalCounts.copies)}
          caption="Each copy is a positive signal: this rewrite was good enough to ship."
        />
        <ImpactStat
          label="Rewrites you wrote"
          count={Number(signalCounts.rewrites)}
          caption="Direct edits via the Adjust modal. Highest-trust signal."
        />
        <ImpactStat
          label="Team rules you authored"
          count={Number(ruleCount)}
          caption={
            user.plan === "team"
              ? "Pinned strings that bypass the LLM for your team."
              : "Custom rules unlock on the Team plan."
          }
        />
      </section>

      {Number(approvedCount) > 0 && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-5 dark:border-emerald-900 dark:bg-emerald-950/20">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            {Number(approvedCount) === 1
              ? "1 of your signals is now a model precedent"
              : `${Number(approvedCount).toLocaleString()} of your signals are now model precedents`}
          </p>
          <p className="mt-2 text-sm text-stone-700 dark:text-stone-300">
            A content designer reviewed and approved them. The model
            reads these on every matching check, so they shape what
            ContentRX recommends to everyone using the platform.
          </p>
        </section>
      )}

      {totalSignals === 0 && (
        <section className="rounded-lg border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-900">
          <p className="text-sm text-stone-700 dark:text-stone-300">
            No signals yet. Run a check on the dashboard to get
            started. Your contributions will show up here.
          </p>
          <p className="mt-2 text-sm text-stone-700 dark:text-stone-300">
            <Link
              href="/dashboard"
              className="underline underline-offset-2"
            >
              Go to the dashboard
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}

function ImpactStat({
  label,
  count,
  caption,
}: {
  label: string;
  count: number;
  caption: string;
}) {
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">
        {count.toLocaleString()}
      </p>
      <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">
        {caption}
      </p>
    </article>
  );
}
