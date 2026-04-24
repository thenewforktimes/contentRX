/**
 * POST /api/feedback/rationale — capture a user's rationale-chain correction.
 *
 * Human-eval build plan Session 21. When a user expands the rationale
 * chain on a verdict and disagrees with one of the hops (primarily
 * moment-detection), clicking the "Not <value>?" button lands here.
 * The row persists into `rationale_feedback` with the matching
 * review_reason subtype so Session 8's review queue (and future
 * moment-classifier retraining) can aggregate them.
 *
 * Auth: Clerk session OR Bearer cx_<api_key>. Same pattern as
 * /api/violations/override. Rate-limited at the same tier so a buggy
 * client can't DoS the feedback endpoint.
 *
 * Privacy:
 *   - `text_hash` is a sha256 the client already computed. We do NOT
 *     accept raw text here — only the hash — so there's no server-side
 *     persistence of the original string.
 *   - `note` is optional, bounded at 500 chars. Same cap as
 *     `violation_overrides.override_reason`.
 */

import { NextResponse } from "next/server";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { RationaleFeedbackRequestSchema } from "@/lib/rationale-feedback";
import { checkRateLimit } from "@/lib/ratelimit";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return withCors(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
    );
  }

  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    return withCors(
      NextResponse.json(
        {
          error: "Rate limit exceeded",
          reset_at: new Date(rl.reset).toISOString(),
        },
        {
          status: 429,
          headers: {
            "retry-after": String(
              Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
            ),
          },
        },
      ),
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RationaleFeedbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return withCors(
      NextResponse.json(
        {
          error: "Invalid request",
          issues: sanitizeZodIssues(parsed.error.issues),
        },
        { status: 400 },
      ),
    );
  }
  const {
    text_hash,
    hop_step,
    correction_type,
    original_value,
    corrected_value,
    note,
    source,
  } = parsed.data;

  const teamIdForFeedback =
    auth.plan === "team"
      ? (auth.teamOwnerUserId ?? auth.user.id)
      : null;

  const db = getDb();
  const [row] = await db
    .insert(schema.rationaleFeedback)
    .values({
      userId: auth.user.id,
      teamId: teamIdForFeedback,
      textHash: text_hash,
      hopStep: hop_step,
      correctionType: correction_type,
      originalValue: original_value,
      correctedValue: corrected_value ?? null,
      note: note ?? null,
      source,
    })
    .returning({ id: schema.rationaleFeedback.id });

  return withCors(
    NextResponse.json(
      envelope({
        result: {
          ok: true,
          id: row?.id ?? null,
          correction_type,
          hop_step,
        },
      }),
    ),
  );
}
