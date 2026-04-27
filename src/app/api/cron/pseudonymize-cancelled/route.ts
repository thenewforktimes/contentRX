/**
 * POST /api/cron/pseudonymize-cancelled — 90-day retention pass (PR-31).
 *
 * Walks every user whose subscription was cancelled >= 90 days ago
 * and who has no other active/trialing/past_due subscription, and
 * pseudonymizes them: drops email + API key, deletes team-scoped
 * rows, sets userId to null on histories. Matches the existing
 * `user.deleted` webhook pattern (audit H-08) so anonymized signal
 * continues to feed engine calibration without retaining personal
 * attribution.
 *
 * The brand promise from the customer-journey diagrams ("your team
 * setup stays put for 90 days") is honored by this gate — within
 * 90 days of cancellation, none of this runs and the customer's
 * full setup is intact for a one-click reactivation.
 *
 * Wiring: GitHub Actions workflow at
 * `.github/workflows/pseudonymize_cancelled.yml` POSTs nightly with
 * the CRON_SECRET bearer.
 */

import { and, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
/** Cap per run to keep transactions bounded; cron repeats nightly. */
const MAX_USERS_PER_RUN = 500;

export async function POST(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const db = getDb();
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);

  // Find user_ids that:
  //   - have at least one subscription with cancelledAt <= cutoff
  //   - have no subscription with status in active/trialing/past_due
  //   - haven't been pseudonymized yet
  const cancelled = (await db
    .selectDistinct({ userId: schema.subscriptions.userId })
    .from(schema.subscriptions)
    .where(
      and(
        sql`${schema.subscriptions.cancelledAt} IS NOT NULL`,
        lte(schema.subscriptions.cancelledAt, cutoff),
      ),
    )) as Array<{ userId: string }>;

  if (cancelled.length === 0) {
    return NextResponse.json({ checked: 0, pseudonymized: 0 });
  }

  const cancelledIds = cancelled.map((c) => c.userId);

  // Filter out users with any non-cancelled subscription.
  const stillActive = (await db
    .selectDistinct({ userId: schema.subscriptions.userId })
    .from(schema.subscriptions)
    .where(
      and(
        inArray(schema.subscriptions.userId, cancelledIds),
        inArray(schema.subscriptions.status, [
          "active",
          "trialing",
          "past_due",
        ]),
      ),
    )) as Array<{ userId: string }>;

  const stillActiveIds = new Set(stillActive.map((s) => s.userId));

  // Filter out users already pseudonymized.
  const candidates = cancelledIds.filter((id) => !stillActiveIds.has(id));
  if (candidates.length === 0) {
    return NextResponse.json({ checked: cancelledIds.length, pseudonymized: 0 });
  }

  const eligibleUsers = (await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        inArray(schema.users.id, candidates),
        isNull(schema.users.pseudonymizedAt),
      ),
    )
    .limit(MAX_USERS_PER_RUN)) as Array<{ id: string }>;

  if (eligibleUsers.length === 0) {
    return NextResponse.json({
      checked: cancelledIds.length,
      pseudonymized: 0,
    });
  }

  let processed = 0;
  for (const { id } of eligibleUsers) {
    try {
      await pseudonymizeUser(id);
      processed += 1;
    } catch (err) {
      console.error(`pseudonymize failed for user ${id}`, err);
    }
  }

  return NextResponse.json({
    checked: cancelledIds.length,
    pseudonymized: processed,
  });
}

/**
 * Anonymize one user. Each step is intentionally separate so a partial
 * failure leaves the user in a recoverable state (next run picks up
 * where this one left off — `pseudonymizedAt` is set last).
 */
async function pseudonymizeUser(userId: string): Promise<void> {
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

  // 2. Delete team-scoped rows (no engine-training value once
  //    anonymized; PII-adjacent because they reference the user's
  //    workflow).
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
  //    `users.email` is NOT NULL + UNIQUE — use a stable sentinel
  //    keyed on the user id so uniqueness is preserved without a
  //    schema change. `apiKeyHash` is cleared to revoke the key.
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

// Mark this route dynamic so Vercel doesn't try to statically
// optimize it — it's a side-effect-only mutation.
export const dynamic = "force-dynamic";

// Suppress unused-import warning while keeping the imports
// intentional for next time we extend the cron.
void notInArray;
