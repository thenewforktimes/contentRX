/**
 * Lazy user provisioning for Clerk-authenticated requests.
 *
 * Background. The Clerk webhook (POST /api/webhooks/clerk) is the
 * canonical place we materialize a Clerk identity into a `users` row.
 * In healthy operation the webhook fires within a second of sign-up and
 * the user lands on /dashboard with their row already present.
 *
 * In practice that's not always true:
 *   - The webhook can be paused, mis-configured, or dropping retries
 *     (incident on 2026-04-25: dedupe race silently dropped a Clerk
 *     retry, no users row ever got created, dashboard dead-ended).
 *   - Webhook delivery has latency. A user can hit /dashboard before
 *     the POST lands.
 *   - Clerk's Backend API has eventual consistency. Immediately after
 *     sign-up, `clerkClient.users.getUser(id)` may 404 for a moment
 *     before the new user is visible to the admin API.
 *   - In dev, webhooks aren't wired at all unless you tunnel with
 *     `svix listen` / ngrok.
 *
 * `getOrProvisionUser` mirrors the lazy-provision `ensureApiKey`
 * pattern: look up by clerkId, and if
 * missing, materialize a minimal row from Clerk's user record. Any
 * failure in the provisioning path (Clerk API hiccup, transient DB
 * error) is logged and returns `null` rather than throwing — the
 * caller is expected to render a "we're finishing setting up your
 * account, refresh in a moment" placeholder, which gives the webhook
 * (and Clerk's Backend API) a beat to catch up. This avoids the
 * global-error-boundary crash from the post-PR-#108 rollout.
 */

import { clerkClient } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logSafeError } from "@/lib/safe-error-log";

export type ProvisionedUser = typeof schema.users.$inferSelect;

async function primaryEmailFromClerk(clerkId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkId);
    const primaryId = user.primaryEmailAddressId;
    const primary = user.emailAddresses.find((e) => e.id === primaryId);
    return (primary ?? user.emailAddresses[0])?.emailAddress ?? null;
  } catch (err) {
    // Audit Phase 4 (2026-05-14): logSafeError instead of console.error.
    // Clerk SDK errors can transitively carry the JWT or the user
    // object (with email) on .message/.cause; the safe-error helper
    // hand-shapes the log to {kind, message, status?} so Vercel logs
    // don't pick up PII through a stringified err. Same fix shape as
    // the May-13 audit applied in /api/check; clerkId is a Clerk-side
    // opaque identifier and OK to log.
    logSafeError(
      `getOrProvisionUser: clerkClient.users.getUser failed for ${clerkId}`,
      err,
    );
    return null;
  }
}

/**
 * Resolve a Clerk ID to its `users` row. If the row is missing, try to
 * materialize one from Clerk's user record. Returns `null` on any
 * provisioning failure so the caller can render a graceful placeholder
 * instead of crashing into the global error boundary.
 *
 * Concurrent provisions from a webhook + a dashboard load race safely
 * via `onConflictDoNothing` on `users.clerk_id`.
 *
 * Round-trip budget:
 *   warm path  → 1 SELECT
 *   cold path  → 1 SELECT + 1 Clerk admin API call + 1 upsert-or-fetch CTE
 *
 * The cold path used to be SELECT → INSERT → SELECT (3 RT). The CTE
 * collapses INSERT-or-fetch into a single statement that returns the
 * inserted row when no conflict, or the existing row when the webhook
 * raced ahead of us. Audit Pf1.
 */
export async function getOrProvisionUser(
  clerkId: string,
): Promise<ProvisionedUser | null> {
  const db = getDb();

  try {
    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.clerkId, clerkId))
      .limit(1);
    if (existing) return existing;
  } catch (err) {
    logSafeError(
      `getOrProvisionUser: initial select failed for ${clerkId}`,
      err,
    );
    return null;
  }

  const email = await primaryEmailFromClerk(clerkId);
  if (!email) {
    // Clerk admin API didn't give us an email (eventual consistency,
    // network blip, or user record genuinely has none). Don't insert
    // a placeholder address — the email column has a UNIQUE constraint
    // and the synthetic value would block a legitimate later insert
    // for the real address. Fall through to the placeholder UI.
    return null;
  }

  // Single-RT upsert-or-fetch. The CTE tries the insert; if it
  // conflicts on either clerk_id or email (the webhook may have
  // landed first, or a prior signup left a stale email row), the
  // RETURNING clause yields nothing, and the UNION ALL falls through
  // to a SELECT. The LIMIT 1 on the outer query ensures we only ever
  // surface the first row — if both branches yield, we want the
  // freshly-inserted one to win.
  try {
    const rows = await db.execute<ProvisionedUser>(sql`
      WITH ins AS (
        INSERT INTO ${schema.users} (clerk_id, email, plan)
        VALUES (${clerkId}, ${email}, 'free')
        ON CONFLICT DO NOTHING
        RETURNING *
      )
      SELECT * FROM ins
      UNION ALL
      SELECT * FROM ${schema.users} WHERE clerk_id = ${clerkId}
      LIMIT 1
    `);
    return rows[0] ?? null;
  } catch (err) {
    logSafeError(
      `getOrProvisionUser: upsert-or-fetch failed for ${clerkId}`,
      err,
    );
    return null;
  }
}
