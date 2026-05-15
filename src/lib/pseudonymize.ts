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
 * The function is named `pseudonymizeUser` for symmetry with the
 * original pseudonymize-then-keep helper. The semantics moved to
 * delete-everything (2026-05-10); the name stays because the
 * dashboard caller already imports it under that name.
 *
 * Order matters: tables with FK references to `users.id` are
 * deleted before the users row itself so explicit deletes leave
 * no orphans. Tables that cascade-on-delete (team_members,
 * team_rules, team_invitations) auto-clear when the users row goes.
 *
 * Sole caller: `POST /api/dashboard/delete-account`. The customer
 * owns the trigger. No auto-pseudonymize cron runs.
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

  // If this user is a team OWNER, reset their members back to
  // standalone Free accounts BEFORE the team rows are torn down.
  // users.teamOwnerUserId has no FK (see schema.ts), so deleting the
  // owner would otherwise strand every member with plan="team" and
  // teamOwnerUserId pointing at a now-deleted row — PlanPill says
  // "Team" while the panel shows the Free upgrade card, and quota
  // resolves against a dead owner id. Keyed on users.teamOwnerUserId,
  // so when `userId` is a member (not an owner) this matches nobody
  // and is a safe no-op. An FK set-null couldn't fix this on its own
  // anyway — it can't also downgrade `plan` — so the application is
  // the source of truth for the reset.
  await db
    .update(schema.users)
    .set({ teamOwnerUserId: null, plan: "free" })
    .where(eq(schema.users.teamOwnerUserId, userId));

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
