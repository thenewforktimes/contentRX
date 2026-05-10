/**
 * Account-deletion helper. The DB-side pass that removes one user
 * row + everything ContentRX has attributed to it.
 *
 * Per Robert's call (2026-05-10) the baseline is the right and
 * ability to be forgotten. No anonymized-history-kept-forever
 * pattern. When a customer deletes their account, every row that
 * ContentRX produced from their use of the product goes too. The
 * only data ContentRX cannot delete from its side is what Stripe
 * holds on its side (Stripe's tax/legal retention, not ContentRX's
 * choice).
 *
 * The function is named `pseudonymizeUser` for backwards-compatibility
 * with existing callers (the cron route and the dashboard delete
 * route both import this name). The semantics moved from
 * pseudonymize-then-keep to delete-everything.
 *
 * Order matters: tables with FK references to `users.id` are
 * deleted before the users row itself so explicit deletes leave
 * no orphans. Tables that cascade-on-delete (team_members,
 * team_rules, team_invitations) auto-clear when the users row goes.
 *
 * Two callers:
 *   - `POST /api/dashboard/delete-account` — the in-product surface.
 *   - `POST /api/cron/pseudonymize-cancelled` — the route exists but
 *     is not currently scheduled in `vercel.json`.
 *
 * This module is the DB-only concern. Stripe and Clerk side-effects
 * live at the respective call sites.
 */

import { eq, or } from "drizzle-orm";
import { getDb, schema } from "@/db";

export async function pseudonymizeUser(userId: string): Promise<void> {
  const db = getDb();

  // 1. Customer content + behavior. All attributed rows go.
  await db
    .delete(schema.violations)
    .where(eq(schema.violations.userId, userId));

  await db
    .delete(schema.violationOverrides)
    .where(eq(schema.violationOverrides.userId, userId));

  await db
    .delete(schema.customerFlaggedReviews)
    .where(eq(schema.customerFlaggedReviews.userId, userId));

  await db
    .delete(schema.rationaleFeedback)
    .where(eq(schema.rationaleFeedback.userId, userId));

  await db
    .delete(schema.suggestionCandidates)
    .where(eq(schema.suggestionCandidates.sourceUserId, userId));

  // 2. Team-scoped rows the user owns. (team_members and
  // team_invitations also cascade on the users row delete below
  // when the user is a team owner; explicit delete here covers
  // membership rows where the user is the member, not the owner.)
  await db
    .delete(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, userId));

  await db
    .delete(schema.teamMembers)
    .where(
      or(
        eq(schema.teamMembers.teamOwnerUserId, userId),
        eq(schema.teamMembers.memberUserId, userId),
      ),
    );

  await db
    .delete(schema.teamInvitations)
    .where(eq(schema.teamInvitations.teamOwnerUserId, userId));

  // 3. Agent and integration rows (team-scoped).
  await db
    .delete(schema.agentRuns)
    .where(eq(schema.agentRuns.teamId, userId));

  await db
    .delete(schema.agentGithubInstallations)
    .where(eq(schema.agentGithubInstallations.teamId, userId));

  // 4. Billing and usage rows.
  await db
    .delete(schema.usage)
    .where(eq(schema.usage.userId, userId));

  await db
    .delete(schema.usageEvents)
    .where(eq(schema.usageEvents.userId, userId));

  await db
    .delete(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId));

  await db
    .delete(schema.creditPacks)
    .where(eq(schema.creditPacks.userId, userId));

  await db
    .delete(schema.overageState)
    .where(eq(schema.overageState.userId, userId));

  // 5. The users row itself. With every dependent row gone above
  // and the team_members / team_rules / team_invitations rows
  // either already gone or set to cascade, the delete succeeds.
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}
