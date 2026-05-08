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

import { and, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { pseudonymizeUser } from "@/lib/pseudonymize";
import { logSafeError } from "@/lib/safe-error-log";

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
      logSafeError(`[pseudonymize-cancelled] pseudonymize failed for user ${id}`, err);
    }
  }

  return NextResponse.json({
    checked: cancelledIds.length,
    pseudonymized: processed,
  });
}

// Mark this route dynamic so Vercel doesn't try to statically
// optimize it — it's a side-effect-only mutation.
export const dynamic = "force-dynamic";

// Suppress unused-import warning while keeping the imports
// intentional for next time we extend the cron.
void notInArray;
