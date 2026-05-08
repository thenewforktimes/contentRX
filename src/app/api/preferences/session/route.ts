/**
 * GET  /api/preferences/session — fetch the next elicitation session for
 *                                 the current user, or a `notice` if they
 *                                 aren't eligible.
 * POST /api/preferences/session — submit a batch of responses.
 *
 * Human-eval build plan Session 31. Clerk-session auth only — this is
 * a UI surface, not a server-to-server API (no Bearer path). Opt-out
 * honored on both verbs: a GET returns `eligible: false, reason:
 * "opted_out"`, and a POST is rejected.
 *
 * Privacy: the pair texts are curated (not user-submitted). Responses
 * store only the user id + pair id + chosen side + optional note.
 */

import { NextResponse } from "next/server";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { envelope } from "@/lib/api-envelope";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import {
  PAIRS_PER_SESSION,
  selectSessionPairs,
  shouldPrompt,
} from "@/lib/preferences";
import { SubmitSessionSchema } from "@/lib/preferences-schemas";
import { checkRateLimit } from "@/lib/ratelimit";
import { logSafeError } from "@/lib/safe-error-log";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

async function currentUser() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);
  return user ?? null;
}

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const rl = await checkRateLimit(user.id);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const db = getDb();

  const [latest] = await db
    .select({ createdAt: schema.preferences.createdAt })
    .from(schema.preferences)
    .where(eq(schema.preferences.userId, user.id))
    .orderBy(desc(schema.preferences.createdAt))
    .limit(1);

  const gate = shouldPrompt({
    optedOutAt: user.preferenceOptedOutAt ?? null,
    lastAnsweredAt: latest?.createdAt ?? null,
    now: new Date(),
  });

  if (!gate.eligible) {
    return NextResponse.json(
      envelope({
        result: {
          eligible: false,
          reason: gate.reason,
          next_eligible_at:
            "nextEligibleAt" in gate && gate.nextEligibleAt
              ? gate.nextEligibleAt.toISOString()
              : null,
        },
      }),
    );
  }

  // Pool of non-retired pairs.
  const pool = await db
    .select()
    .from(schema.preferencePairs)
    .where(isNull(schema.preferencePairs.retiredAt));

  // Pair IDs the user has seen, so we don't re-show.
  const seenRows = await db
    .select({ pairId: schema.preferences.pairId })
    .from(schema.preferences)
    .where(eq(schema.preferences.userId, user.id));
  const seenPairIds = seenRows.map((r) => r.pairId);

  // Precedent counts (aligned responses by key) — lets us prioritise
  // under-sampled (standard, content_type) tuples.
  const precedentRows = await db
    .select({
      standardId: schema.preferencePairs.standardId,
      contentType: schema.preferencePairs.contentType,
      aligned: sql<number>`count(*)::int`,
    })
    .from(schema.preferences)
    .innerJoin(
      schema.preferencePairs,
      eq(schema.preferences.pairId, schema.preferencePairs.id),
    )
    .where(
      sql`${schema.preferencePairs.expectedPreferred} = ${schema.preferences.preferred}`,
    )
    .groupBy(schema.preferencePairs.standardId, schema.preferencePairs.contentType);
  const precedentCounts: Record<string, number> = {};
  for (const r of precedentRows) {
    precedentCounts[`${r.standardId}|${r.contentType}`] = Number(r.aligned);
  }

  const picked = selectSessionPairs({
    availablePairs: pool,
    seenPairIds,
    precedentCounts,
    seed: user.id,
    limit: PAIRS_PER_SESSION,
  });

  // Public shape — hide admin-only fields.
  const publicPairs = picked.map((p) => ({
    pair_id: p.id,
    moment: p.moment,
    content_type: p.contentType,
    standard_id: p.standardId,
    left_text: p.leftText,
    right_text: p.rightText,
    prompt: p.prompt,
  }));

  return NextResponse.json(
    envelope({
      result: {
        eligible: true,
        reason: gate.reason,
        pairs: publicPairs,
        pairs_per_session: PAIRS_PER_SESSION,
      },
    }),
  );
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  if (user.preferenceOptedOutAt) {
    return NextResponse.json(
      { error: "You've opted out of preference elicitation." },
      { status: 403 },
    );
  }

  const rl = await checkRateLimit(user.id);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = SubmitSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: sanitizeZodIssues(parsed.error.issues),
      },
      { status: 400 },
    );
  }

  const db = getDb();

  // Guard against pair IDs that don't exist. A client with stale pair
  // IDs (e.g. pair retired between GET and POST) should get a helpful
  // error, not a silent insert failure.
  const pairIds = parsed.data.responses.map((r) => r.pair_id);
  const existing = await db
    .select({ id: schema.preferencePairs.id })
    .from(schema.preferencePairs)
    .where(sql`${schema.preferencePairs.id} in ${pairIds}`);
  const existingSet = new Set(existing.map((r) => r.id));
  const unknown = pairIds.filter((id) => !existingSet.has(id));
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        error: "One or more pair IDs don't exist.",
        unknown_pair_ids: unknown,
      },
      { status: 400 },
    );
  }

  // The `note` field accepts free-text from the user. Screen for
  // credit cards / SSNs / API keys before persisting — same posture
  // as /api/customer-flag and /api/calibration/copy-event. Reject
  // the entire batch on any hit so PII never lands in the row,
  // mirroring the peer-route rejection-not-redaction default.
  const noteCorpus = parsed.data.responses
    .map((r) => r.note ?? "")
    .filter((s) => s.length > 0)
    .join("\n");
  if (noteCorpus.length > 0) {
    const sensitivePatterns = detectSensitivePatterns(noteCorpus);
    if (sensitivePatterns.length > 0) {
      return NextResponse.json(
        {
          error: sensitiveDataErrorMessage(sensitivePatterns),
          patterns: sensitivePatterns,
        },
        { status: 400 },
      );
    }
  }

  const teamId = user.teamOwnerUserId ?? user.id;

  const values = parsed.data.responses.map((r) => ({
    userId: user.id,
    teamId,
    pairId: r.pair_id,
    preferred: r.preferred,
    note: r.note ?? null,
    timeMs: r.time_ms ?? null,
  }));

  let inserted = 0;
  try {
    const rows = await db
      .insert(schema.preferences)
      .values(values)
      .onConflictDoNothing({
        target: [schema.preferences.userId, schema.preferences.pairId],
      })
      .returning({ id: schema.preferences.id });
    inserted = rows.length;
  } catch (err) {
    logSafeError("[preferences/session] insert failed", err);
    return NextResponse.json(
      { error: "Failed to record preferences." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    envelope({
      result: {
        submitted: parsed.data.responses.length,
        inserted,
        skipped_duplicates: parsed.data.responses.length - inserted,
      },
    }),
    { status: 201 },
  );
}
