/**
 * /dashboard/calibrate — pairwise-preference elicitation surface.
 *
 * Human-eval build plan Session 31. A 60-second prompt surfaced once
 * per week per user, opt-outable. Three hand-picked pairs; user picks
 * left / right / neither. Answers feed the auto-annotator's precedent
 * index as a second signal source.
 *
 * Scheduling logic lives in `src/lib/preferences.ts`. This page does
 * the server-side eligibility check and renders the client form.
 */

import { auth } from "@clerk/nextjs/server";
import { desc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import {
  PAIRS_PER_SESSION,
  selectSessionPairs,
  shouldPrompt,
} from "@/lib/preferences";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { CalibrateForm } from "./calibrate-form";

export default async function CalibratePage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/calibrate");
  }

  const db = getDb();
  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-neutral-200 p-6 text-sm dark:border-neutral-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const [latest] = await db
    .select({ createdAt: schema.preferences.createdAt })
    .from(schema.preferences)
    .where(eq(schema.preferences.userId, user.id))
    .orderBy(desc(schema.preferences.createdAt))
    .limit(1);

  const gate = shouldPrompt({
    optedOutAt: user.preferenceOptedOutAt ?? null,
    lastAnsweredAt: latest?.createdAt ?? null,
    now: new Date(),
  });

  if (!gate.eligible) {
    return (
      <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <header>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
            Calibration · help shape ContentRX
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {gate.reason === "opted_out"
              ? "You&apos;ve opted out of calibration prompts."
              : "You&apos;ve already helped this week. Thank you."}
          </h1>
        </header>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {gate.reason === "opted_out"
            ? "Calibration prompts are a 60-second pairwise preference check, once a week. They feed the human-judgment signal behind the content model. You can opt back in whenever you want."
            : "Pairwise preference prompts surface once every 7 days. We don&apos;t want to make calibration a chore. Come back next week."}
        </p>
        {gate.reason === "opted_out" && (
          <form
            action="/api/preferences/opt-out"
            method="delete"
            className="mt-2"
          >
            {/*
              Browsers don't send DELETE from <form>; a client button
              with fetch() is the real path. The markup below is a
              no-JS fallback that links back to the dashboard; opt-
              back-in requires hitting the API from the account
              settings UI once that lands.
            */}
            <Link
              href="/dashboard"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Back to dashboard
            </Link>
          </form>
        )}
        {"nextEligibleAt" in gate && gate.nextEligibleAt && (
          <p className="text-xs text-neutral-500">
            Next prompt available:{" "}
            <span className="font-mono">
              {gate.nextEligibleAt.toLocaleString()}
            </span>
          </p>
        )}
      </section>
    );
  }

  const pool = await db
    .select()
    .from(schema.preferencePairs)
    .where(isNull(schema.preferencePairs.retiredAt));

  const seenRows = await db
    .select({ pairId: schema.preferences.pairId })
    .from(schema.preferences)
    .where(eq(schema.preferences.userId, user.id));
  const seenPairIds = seenRows.map((r) => r.pairId);

  // Precedent counts — drives under-sampled tuples to the front.
  const precedentRows = await db
    .select({
      standardId: schema.preferencePairs.standardId,
      contentType: schema.preferencePairs.contentType,
      aligned: sql<number>`count(*)::int`,
    })
    .from(schema.preferences)
    .innerJoin(
      schema.preferencePairs,
      eq(schema.preferences.pairId, schema.preferencePairs.id),
    )
    .where(
      sql`${schema.preferencePairs.expectedPreferred} = ${schema.preferences.preferred}`,
    )
    .groupBy(schema.preferencePairs.standardId, schema.preferencePairs.contentType);
  const precedentCounts: Record<string, number> = {};
  for (const r of precedentRows) {
    precedentCounts[`${r.standardId}|${r.contentType}`] = Number(r.aligned);
  }

  const picked = selectSessionPairs({
    availablePairs: pool,
    seenPairIds,
    precedentCounts,
    seed: user.id,
    limit: PAIRS_PER_SESSION,
  });

  if (picked.length === 0) {
    return (
      <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <header>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
            Calibration
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            You&apos;ve answered every pair in the current pool.
          </h1>
        </header>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          We&apos;ll add fresh pairs as the taxonomy evolves. Come back in a
          few weeks.
        </p>
        <Link
          href="/dashboard"
          className="w-max rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Back to dashboard
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Calibration · 60 seconds
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          Which of these reads better?
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          {PAIRS_PER_SESSION} pairs, one minute. Your picks feed the
          human-judgment signal behind ContentRX&apos;s content model.
          Pick the side that reads better for the context, or{" "}
          <em>Neither</em> if neither answer is acceptable.
        </p>
      </header>
      <CalibrateForm
        pairs={picked.map((p) => ({
          pair_id: p.id,
          moment: p.moment,
          content_type: p.contentType,
          // standard_id intentionally omitted — ADR 2026-04-25
          // private-taxonomy boundary. The CalibrateForm only needs
          // pair_id to correlate the user's pick back to the row.
          left_text: p.leftText,
          right_text: p.rightText,
          prompt: p.prompt,
        }))}
      />
      <p className="text-xs text-neutral-500">
        Not into this right now?{" "}
        <OptOutButton />
      </p>
    </section>
  );
}

function OptOutButton() {
  return (
    <button
      form="calibrate-opt-out"
      className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
      formAction="/api/preferences/opt-out"
      formMethod="post"
    >
      Opt out of calibration prompts.
    </button>
  );
}
