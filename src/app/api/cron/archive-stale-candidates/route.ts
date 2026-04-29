/**
 * POST /api/cron/archive-stale-candidates — daily auto-archive pass
 *                                            for the calibration queue.
 *
 * Block 4 (polish) of the calibration plan. Walks every
 * suggestion_candidates row that's been pending >90 days with no
 * triage and flips its status to 'rejected'. Keeps /admin/suggestions
 * from rotting under candidates Robert never got to.
 *
 * Identification of system-archived rows (vs human-rejected): the
 * combination `status='rejected' AND reviewed_by IS NULL AND
 * reviewed_at IS NOT NULL` means "system archive." Human rejects
 * always set reviewed_by to the founder's user id. This implicit
 * marker avoids a schema migration just for one bool.
 *
 * Auth: Bearer CRON_SECRET via requireCronAuth, same as every other
 * /api/cron/* endpoint in this repo.
 *
 * Wiring: GitHub Actions workflow at
 * `.github/workflows/archive_stale_candidates.yml` POSTs daily.
 */

import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
/** Cap per run to keep the UPDATE transaction bounded. The cron
 *  repeats daily, so a backlog drains across runs. */
const MAX_ROWS_PER_RUN = 1000;

export async function POST(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const db = getDb();
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  const now = new Date();

  // Find the IDs first, then update in a bounded batch. Splitting
  // the read from the write keeps the transaction small even when
  // the result set is large.
  const stale = await db
    .select({ id: schema.suggestionCandidates.id })
    .from(schema.suggestionCandidates)
    .where(
      and(
        eq(schema.suggestionCandidates.status, "pending"),
        lte(schema.suggestionCandidates.createdAt, cutoff),
      ),
    )
    .limit(MAX_ROWS_PER_RUN);

  if (stale.length === 0) {
    return NextResponse.json({ archived: 0 });
  }

  const ids = stale.map((r) => r.id);

  await db
    .update(schema.suggestionCandidates)
    .set({
      status: "rejected",
      reviewedAt: now,
      // reviewed_by stays NULL — that's the marker for system
      // archive. Human rejects via /admin/suggestions set it to
      // the founder's user id.
      reviewedBy: null,
    })
    .where(
      and(
        isNull(schema.suggestionCandidates.reviewedAt),
        inArray(schema.suggestionCandidates.id, ids),
      ),
    );

  return NextResponse.json({
    archived: ids.length,
    cutoff: cutoff.toISOString(),
  });
}
