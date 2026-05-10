/**
 * Pseudonymization helper. The DB-side pass that turns one user row
 * into an anonymized historical artifact.
 *
 *   1. Detach personal attribution from anonymizable rows
 *      (`violations`, `violation_overrides`) by setting their
 *      `user_id` to null. The hashed text and verdicts stay so engine
 *      calibration retains the signal but the link back to the
 *      person is gone.
 *
 *   2. Delete rows whose existence depends on a specific consent
 *      grant by this user: `customer_flagged_reviews` (per ADR
 *      2026-05-11, the row IS the consent record). Account deletion
 *      revokes those grants.
 *
 *   3. Delete team-scoped rows that exist only because the user was
 *      operating ContentRX as a team owner: `team_rules`,
 *      `team_members`, `team_invitations`. No engine-training value,
 *      and PII-adjacent because they reference the user's workflow.
 *
 *   4. Replace identifiers on the `users` row with sentinel values.
 *      `users.email` is NOT NULL + UNIQUE, so the sentinel is keyed
 *      on the user id (`pseudonymized-{id}@deleted.contentrx.io`) so
 *      uniqueness is preserved without a schema change. The API key
 *      hash + prefix + Stripe customer id + Ditto key are cleared
 *      outright. `pseudonymizedAt` is set last so a partial failure
 *      leaves the user in a recoverable state. The next run picks up
 *      where this one left off.
 *
 * Callers: `POST /api/dashboard/delete-account` is the in-product
 * surface today. `POST /api/cron/pseudonymize-cancelled` exists as a
 * route but is not currently scheduled in `vercel.json`.
 *
 * This module is the DB-only concern. Stripe and Clerk side-effects
 * live at the respective call sites.
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

  // Per ADR 2026-05-11 the customer flagged reviews row represents a
  // specific consent grant by this user. When the account is deleted,
  // the grant is meaningless. Delete the rows entirely rather than
  // anonymizing them. (Other historical tables retain the signal in
  // anonymized form. The consent path is different in kind.)
  await db
    .delete(schema.customerFlaggedReviews)
    .where(eq(schema.customerFlaggedReviews.userId, userId));

  // 2. Delete team-scoped rows.
  await db
    .delete(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, userId));

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
