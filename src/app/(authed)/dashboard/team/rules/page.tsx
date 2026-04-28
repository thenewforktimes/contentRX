/**
 * /dashboard/team/rules — admin UI for team-specific rule overrides.
 *
 * Server component: loads the team's rules + the standards library
 * from the engine's JSON, then hands both to the client island for
 * optimistic toggling and form-driven creation.
 *
 * Gating: only team-plan users see this page's content. The owner
 * gets edit controls; team members get a read-only view. Free/Pro
 * users hit an upgrade nudge.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { CATEGORIES } from "@/lib/standards";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { TeamRulesClient, type TeamRule } from "./rules-client";

export default async function TeamRulesPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/team/rules");
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

  if (user.plan !== "team") {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <h1 className="text-lg font-semibold">Team rules</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Available on the Team plan. Disable a built-in rule for your
          whole team, rewrite the wording your team sees, or add your
          own regex-based rules on top.
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

  const ownerId = user.teamOwnerUserId ?? user.id;
  const rows = await db
    .select()
    .from(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, ownerId));

  const rules: TeamRule[] = rows.map((r) => ({
    id: r.id,
    teamOwnerUserId: r.teamOwnerUserId,
    standardId: r.standardId,
    action: r.action as TeamRule["action"],
    ruleJson: (r.ruleJson ?? {}) as Record<string, unknown>,
  }));

  const isAdmin = user.teamOwnerUserId === null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dashboard"
          className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Team rules</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          Disable standards, override the wording shown to your team, or add
          custom rules as regex patterns. Changes apply to every evaluation
          your team runs.
        </p>
      </header>

      <TeamRulesClient
        categories={CATEGORIES}
        rules={rules}
        isAdmin={isAdmin}
      />
    </div>
  );
}
