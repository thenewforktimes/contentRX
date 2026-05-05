/**
 * Pseudonymization helper. The DB-side pass that turns one user row
 * into an anonymized historical artifact:
 *
 *   1. Detach personal attribution from training-relevant rows
 *      (`violations`, `violation_overrides`, `preferences`) by setting
 *      their `user_id` to null. The hashed text + verdicts stay so
 *      engine calibration retains the signal; the link back to the
 *      person is gone.
 *
 *   2. Delete team-scoped rows that exist only because the user was
 *      operating ContentRX as a team owner: `team_rules`,
 *      `team_custom_examples`, `team_members`, `team_invitations`.
 *      No engine-training value, and PII-adjacent because they
 *      reference the user's workflow.
 *
 *   3. Replace identifiers on the `users` row with sentinel values.
 *      `users.email` is NOT NULL + UNIQUE, so the sentinel is keyed
 *      on the user id (`pseudonymized-{id}@deleted.contentrx.io`) so
 *      uniqueness is preserved without a schema change. The API key
 *      hash + prefix + Stripe customer id + Ditto key are cleared
 *      outright. `pseudonymizedAt` is set last so a partial failure
 *      leaves the user in a recoverable state — the next run picks
 *      up where this one left off.
 *
 * Two callers:
 *   - `POST /api/cron/pseudonymize-cancelled` — 90-day retention
 *     pass for cancelled subscriptions.
 *   - `POST /api/dashboard/delete-account` — on-demand delete from
 *     the dashboard. Wraps Stripe cancellation + Clerk delete around
 *     this helper so the user is fully retired in one call.
 *
 * This module is the DB-only concern. Stripe/Clerk side-effects live
 * at their respective call sites.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * Anonymize one user. Each step is intentionally separate so a partial
 * failure leaves the user in a recoverable state — `pseudonymizedAt`
 * is set last.
 */
export async function pseudonymizeUser(userId: string): Promise<void> {
  const db = getDb();

  // 1. Drop personal attribution from training-relevant rows.
  await db
    .update(schema.violations)
    .set({ userId: null })
    .where(eq(schema.violations.userId, userId));

  await db
    .update(schema.violationOverrides)
    .set({ userId: null })
    .where(eq(schema.violationOverrides.userId, userId));

  await db
    .update(schema.preferences)
    .set({ userId: null })
    .where(eq(schema.preferences.userId, userId));

  // 2. Delete team-scoped rows.
  await db
    .delete(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, userId));

  await db
    .delete(schema.teamCustomExamples)
    .where(eq(schema.teamCustomExamples.teamOwnerUserId, userId));

  await db
    .delete(schema.teamMembers)
    .where(eq(schema.teamMembers.teamOwnerUserId, userId));

  await db
    .delete(schema.teamInvitations)
    .where(eq(schema.teamInvitations.teamOwnerUserId, userId));

  // 3. Replace identifiers on the users row with sentinel values.
  await db
    .update(schema.users)
    .set({
      email: `pseudonymized-${userId}@deleted.contentrx.io`,
      apiKeyHash: null,
      apiKeyPrefix: null,
      apiKeyCreatedAt: null,
      stripeCustomerId: null,
      dittoApiKeyEncrypted: null,
      pseudonymizedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}
