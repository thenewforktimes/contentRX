/**
 * POST /api/dashboard/delete-account — on-demand account deletion.
 *
 * The dashboard-side counterpart to the 90-day pseudonymization cron.
 * The cron handles cancelled subscriptions after a grace period; this
 * endpoint handles "delete my account NOW" intent directly from the
 * settings page.
 *
 * Order of operations matters:
 *   1. Cancel any active Stripe subscription. We need the
 *      `stripeCustomerId` link to do this, so it has to happen before
 *      pseudonymization clears it.
 *   2. Pseudonymize the DB row + dependent rows (existing helper).
 *      This is the data-side commitment. After this step, even if the
 *      Clerk delete in step 3 fails, the user's data is anonymized.
 *   3. Delete the Clerk user. This triggers the user.deleted webhook
 *      which hard-deletes the (already-pseudonymized) row. The
 *      webhook is idempotent and safe to race with this call.
 *
 * Steps 1 and 3 are best-effort — the user can finish either via the
 * Stripe portal or by deleting their Clerk account manually if our
 * server-side cleanup hits an error. The DB pseudonymization (step 2)
 * is the load-bearing one and is what the privacy page commits to.
 *
 * Auth: Clerk session only. No Bearer/cx_token path — destructive
 * dashboard actions never accept a token a CLI/plugin already holds.
 *
 * Confirmation: the request body must include a literal-match
 * confirmation string. Two layers of typed-confirm: the UI requires
 * the user to type "DELETE", and this endpoint enforces the same.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { logSafeError } from "@/lib/safe-error-log";
import { pseudonymizeUser } from "@/lib/pseudonymize";
import { getStripe } from "@/lib/stripe";

const REQUIRED_CONFIRMATION = "DELETE";

const RequestSchema = z.object({
  confirmation: z.string(),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request: confirmation field required" },
      { status: 400 },
    );
  }
  if (parsed.data.confirmation !== REQUIRED_CONFIRMATION) {
    return NextResponse.json(
      {
        error: `Confirmation mismatch: type "${REQUIRED_CONFIRMATION}" exactly to confirm`,
      },
      { status: 400 },
    );
  }

  const db = getDb();
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    // Already gone (or never provisioned). Treat as a successful
    // no-op — the user's intent is "stop existing in this system,"
    // and that's already true.
    return NextResponse.json({ ok: true });
  }

  // 1. Cancel any active Stripe subscriptions for this user.
  await cancelActiveSubscriptions(user.id);

  // 2. Pseudonymize the DB. This is the load-bearing commitment.
  await pseudonymizeUser(user.id);

  // 3. Delete the Clerk user. The user.deleted webhook will then
  //    hard-delete the (already-pseudonymized) row from our DB.
  try {
    const clerk = await clerkClient();
    await clerk.users.deleteUser(clerkId);
  } catch (err) {
    // Best-effort. The DB is already pseudonymized; the user can
    // finish the deletion in their Clerk profile if needed. Log and
    // continue.
    logSafeError("delete-account.clerk-delete", err);
  }

  return NextResponse.json({ ok: true });
}

/**
 * Cancel any subscription on this user that's still in a billable
 * state. Best-effort: if Stripe rejects the cancel (already cancelled,
 * network error, etc.) we log and continue. The pseudonymization
 * runs either way; the user can cancel from the Stripe customer
 * portal if our cancel call fails.
 */
async function cancelActiveSubscriptions(userId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      stripeSubId: schema.subscriptions.stripeSubId,
      status: schema.subscriptions.status,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId));

  const billable = rows.filter(
    (row): row is { stripeSubId: string; status: string } =>
      Boolean(row.stripeSubId) &&
      ["active", "trialing", "past_due"].includes(row.status),
  );

  if (billable.length === 0) return;

  const stripe = getStripe();
  for (const { stripeSubId } of billable) {
    try {
      await stripe.subscriptions.cancel(stripeSubId);
    } catch (err) {
      logSafeError("delete-account.stripe-cancel", err);
    }
  }
}

export const dynamic = "force-dynamic";
