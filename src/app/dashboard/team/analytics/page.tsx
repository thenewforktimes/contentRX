/**
 * /dashboard/team/analytics — Team-plan analytics dashboard.
 *
 * Server component handles gating + non-team-plan upsell. The actual
 * charts live in the client island so Recharts + data fetching happen
 * browser-side. Keeps the server component small and the RSC payload
 * independent of Recharts types.
 *
 * Non-admin team members get 403 rendering per BUILD_PLAN §17.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { AnalyticsClient } from "./analytics-client";

export default async function TeamAnalyticsPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/team/analytics");
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
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <h1 className="text-lg font-semibold">Team analytics</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Analytics are a Team-plan feature — track violations by
          standard, daily trends, and per-member activity. Upgrade to
          turn this on.
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

  // Owner-only per BUILD_PLAN §17 and the 2026-04-22 audit (BE-M-05).
  // Non-admin team members see an explanation instead of data; the API
  // side enforces this with a 403 for belt-and-suspenders.
  const isAdmin = user.teamOwnerUserId === null;
  if (!isAdmin) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <h1 className="text-lg font-semibold">Team analytics</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Only the team owner can see analytics. Ask your team owner if
          you need aggregate numbers for your team&apos;s ContentRX usage.
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

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dashboard"
          className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Team analytics</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Every evaluation your team runs rolls up here. Violations table
          data only — no text or user content is ever stored.
        </p>
      </header>

      <AnalyticsClient />
    </div>
  );
}
