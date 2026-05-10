/**
 * DELETE /api/customer-flag/[id] — in-product revoke of a previously
 * shared check.
 *
 * Robert's call (2026-05-10): customers should never have to email to
 * revoke a check they didn't mean to share. This is the in-product
 * revoke path. The /dashboard/shared page's RevokeButton calls it.
 *
 * Auth: Clerk session OR Bearer cx_<api_key>. Same as the parent
 * /api/customer-flag POST route.
 *
 * Authorization: the row's `user_id` must equal the resolved auth
 * user. ContentRX never lets one customer remove another's shared
 * check, even within a team.
 *
 * On success: the row is deleted, full stop. No anonymized-keep,
 * no per-row tombstone. Per ADR 2026-05-11 the row IS the consent
 * record; revoking the consent revokes the record.
 */

import { and, eq } from "drizzle-orm";
import { corsJson, corsPreflight } from "@/lib/cors";
import { resolveAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/ratelimit";
import { logSafeError } from "@/lib/safe-error-log";
import { getDb, schema } from "@/db";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);

  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await params;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) {
    return json({ error: "Invalid id" }, { status: 400 });
  }

  // Rate limit to match the rest of the customer-flag surface. Prevents
  // a misbehaving client from churning the DB even if it has valid auth.
  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    return json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    const db = getDb();
    const deleted = await db
      .delete(schema.customerFlaggedReviews)
      .where(
        and(
          eq(schema.customerFlaggedReviews.id, id),
          eq(schema.customerFlaggedReviews.userId, auth.user.id),
        ),
      )
      .returning({ id: schema.customerFlaggedReviews.id });

    if (deleted.length === 0) {
      // Either the row doesn't exist or it belongs to another user.
      // The two are indistinguishable in the response so this surface
      // can't be probed for foreign row ids.
      return json({ error: "Not found" }, { status: 404 });
    }

    return json({ ok: true, id: deleted[0]!.id });
  } catch (err) {
    logSafeError("[customer-flag DELETE] failed", err);
    return json(
      { error: "Could not remove the check. Try again in a moment." },
      { status: 500 },
    );
  }
}
