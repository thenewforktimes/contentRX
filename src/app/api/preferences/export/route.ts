/**
 * GET /api/preferences/export — dump aggregated preference signals
 *                               for offline tooling (auto-annotator).
 *
 * Human-eval build plan Session 31. Admin-gated. Authorization with
 * `Authorization: Bearer <CRON_SECRET>` (matches weekly-digest + other
 * server-to-server endpoints) so a cron job or the auto-annotator CLI
 * can pull the export without a Clerk session.
 *
 * Shape: a list of `{pair, responses}` so the consumer can aggregate
 * however it wants. The server doesn't pre-bucket — consumers differ
 * (auto-annotator aggregates; a dashboard page might want raw
 * responses for per-user audit). Both patterns build on
 * `buildPreferenceSignals` in `src/lib/preferences.ts`.
 *
 * Privacy: the exported rows contain `userId` so it's not safe to
 * leak. Admin-only.
 */

import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireEnv } from "@/lib/require-env";

function requireCronAuth(req: Request): NextResponse | null {
  const expected = requireEnv("CRON_SECRET");
  const got = req.headers.get("authorization");
  if (got !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const db = getDb();

  const pairs = await db.select().from(schema.preferencePairs);
  const responses = await db
    .select({
      pairId: schema.preferences.pairId,
      userId: schema.preferences.userId,
      teamId: schema.preferences.teamId,
      preferred: schema.preferences.preferred,
      note: schema.preferences.note,
      timeMs: schema.preferences.timeMs,
      createdAt: schema.preferences.createdAt,
    })
    .from(schema.preferences);

  // Group responses by pair_id for easy consumption.
  const byPair: Record<
    string,
    {
      pair_id: string;
      user_id: string;
      team_id: string | null;
      preferred: string;
      note: string | null;
      time_ms: number | null;
      created_at: string;
    }[]
  > = {};
  for (const r of responses) {
    const bucket = byPair[r.pairId] ?? (byPair[r.pairId] = []);
    bucket.push({
      pair_id: r.pairId,
      user_id: r.userId,
      team_id: r.teamId,
      preferred: r.preferred,
      note: r.note,
      time_ms: r.timeMs,
      created_at: r.createdAt.toISOString(),
    });
  }

  const items = pairs
    .filter((p) => !p.retiredAt)
    .map((p) => ({
      pair: {
        id: p.id,
        seed_key: p.seedKey,
        moment: p.moment,
        content_type: p.contentType,
        standard_id: p.standardId,
        left_text: p.leftText,
        right_text: p.rightText,
        expected_preferred: p.expectedPreferred,
        prompt: p.prompt,
      },
      responses: byPair[p.id] ?? [],
    }));

  const totalResponses = responses.length;
  const pairsWithResponses = items.filter((i) => i.responses.length > 0).length;

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      total_pairs: items.length,
      pairs_with_responses: pairsWithResponses,
      total_responses: totalResponses,
      items,
    },
    { headers: { "Cache-Control": "private, max-age=0, no-cache" } },
  );
}
