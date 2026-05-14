/**
 * GET/POST /api/cron/purge-expired-invites — drop unaccepted, expired
 * team_invitations so the table doesn't accrete stale rows.
 *
 * An invite expires 7 days after creation; once past that window and
 * never accepted, it can't be redeemed. Keeping it occupies a slot in
 * the partial-unique index that gates "is there a pending invite?"
 * which is a soft footgun if the same email later needs a fresh
 * invite. Nightly cron is plenty — there's no urgency.
 *
 * Wiring: scheduled at 03:30 UTC daily via `vercel.json`. Auth is
 * `Authorization: Bearer <CRON_SECRET>` via `requireCronAuth` (Vercel
 * Cron passes the header automatically). GET alias added so Vercel
 * Cron (which sends GET) reaches the handler.
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

// GET alias for Vercel Cron (which sends GET). The route is purely
// destructive (DELETE), so unlike `/api/cron/agent-run` and
// `/api/cron/rollback-monitor` there's no concern about a curious
// browser request causing side effects beyond what's intended — but
// the bearer-secret gate still applies via requireCronAuth, so an
// unauthenticated probe 401s.
export const GET = POST;
