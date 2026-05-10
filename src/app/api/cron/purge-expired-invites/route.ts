/**
 * POST /api/cron/purge-expired-invites — drop unaccepted, expired
 * team_invitations so the table doesn't accrete stale rows.
 *
 * An invite expires 7 days after creation; once past that window and
 * never accepted, it can't be redeemed. Keeping it occupies a slot in
 * the partial-unique index that gates "is there a pending invite?"
 * which is a soft footgun if the same email later needs a fresh
 * invite. Nightly cron is plenty — there's no urgency.
 *
 * Wiring: same CRON_SECRET pattern as the other cron endpoints. Add
 * a scheduler entry in `.github/workflows/` (or vercel.ts cron) that
 * POSTs once a day.
 */

import { and, isNull, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";

export async function POST(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const db = getDb();
  const result = await db
    .delete(schema.teamInvitations)
    .where(
      and(
        isNull(schema.teamInvitations.acceptedAt),
        lt(schema.teamInvitations.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.teamInvitations.id });

  return NextResponse.json({ purged: result.length });
}
