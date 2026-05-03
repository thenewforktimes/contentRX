/**
 * `/dashboard/rules` — single canonical rules surface.
 *
 * Phase 6 of the pre-pilot launch build. Replaces the Team-only
 * `/dashboard/team/rules` (which now redirects here). Conditional
 * rendering by plan tier:
 *
 *   - Free / Pro / Scale: read-only "What your team's rules check
 *                         for" panel. Plain-language rule + correct/
 *                         incorrect example. Substrate identifiers
 *                         (standard_id) never appear.
 *   - Team owner:         existing disable/override/add editor.
 *   - Team member:        editor renders read-only (only the owner
 *                         can edit rules).
 *
 * Auth + DB + redirect handled here; both rendering paths share the
 * same data load (categories from the standards library + per-team
 * overrides from `team_rules`).
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { CATEGORIES, type StandardSummary } from "@/lib/standards";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { ReadOnlyRulesView } from "./read-only-view";
import { TeamRulesClient, type TeamRule } from "./rules-client";

export default async function DashboardRulesPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/rules");
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

  const isTeamPlan = user.plan === "team";
  const isOwner = user.teamOwnerUserId === null;

  // Build a Set of disabled standard ids (substrate-side) so the
  // read-only view can mark "not part of your team's review" without
  // ever exposing the id itself to the rendered HTML.
  const disabledIds = new Set(
    rules.filter((r) => r.action === "disable").map((r) => r.standardId),
  );
  const customRuleCount = rules.filter((r) => r.action === "add").length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dashboard"
          className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
        >
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {isTeamPlan ? "Team rules" : "What your team's rules check for"}
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          {isTeamPlan
            ? "Disable standards, override the wording shown to your team, or add custom rules as regex patterns. Changes apply to every evaluation your team runs."
            : "The patterns ContentRX checks every string against. Plain-language summary so you know what's being reviewed before you ship copy. Team-plan owners can disable individual standards or override their wording."}
        </p>
      </header>

      {isTeamPlan ? (
        <TeamRulesClient
          categories={CATEGORIES}
          rules={rules}
          isAdmin={isOwner}
        />
      ) : (
        <ReadOnlyRulesView
          categories={publicizeCategories(CATEGORIES, disabledIds)}
          customRuleCount={customRuleCount}
        />
      )}
    </div>
  );
}

/**
 * Strip substrate ids from the categories before they hit the
 * read-only view. ADR 2026-04-25: standard_id never reaches a Free /
 * Pro / Scale surface; only the rule + correct/incorrect examples
 * + a derived `disabled` flag.
 */
function publicizeCategories(
  categories: typeof CATEGORIES,
  disabledIds: Set<string>,
) {
  return categories.map((cat) => ({
    name: cat.name,
    standards: cat.standards.map((s: StandardSummary) => ({
      rule: s.rule,
      correct: s.correct,
      incorrect: s.incorrect,
      disabled: disabledIds.has(s.id),
    })),
  }));
}
