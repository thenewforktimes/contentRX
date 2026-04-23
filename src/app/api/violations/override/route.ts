/**
 * POST /api/violations/override — capture a user's override of a finding.
 *
 * Auth: Clerk session OR Bearer cx_<api_key>.
 *
 * Body:
 *   {
 *     standard_id: string,                                    // required
 *     text: string,                                           // required, hashed server-side
 *     moment?: string,
 *     override_type: "dismiss" | "accept_as_review" | "mark_false_positive",
 *     override_reason?: string,                               // free-text, optional
 *     source?: "plugin" | "cli" | "action" | "dashboard",     // default "plugin"
 *     violation_id?: string,                                  // optional FK to violations.id
 *   }
 *
 * Privacy: only `sha256(text)` persists in `violation_overrides.text_hash`;
 * the raw text is never written. Same contract as `violations.text_hash`.
 *
 * Wire-up:
 *   - Plugin's "Dismiss" button → POST here with override_type="dismiss"
 *   - GH Action "/contentrx ignore <STD>" PR comment → planned follow-up
 *
 * BUILD_PLAN_v2 Session 11.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { hashText } from "@/lib/log-violations";
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

const RequestSchema = z.object({
  standard_id: z.string().min(1).max(64),
  // Same 100k cap as /api/check so a malicious body can't blow up the
  // SHA pipeline. Text is hashed and discarded — never persisted.
  text: z.string().min(1).max(100_000),
  moment: z.string().min(1).max(64).optional(),
  override_type: z.enum(["dismiss", "accept_as_review", "mark_false_positive"]),
  override_reason: z.string().min(1).max(500).optional(),
  source: z.enum(["plugin", "cli", "action", "dashboard"]).default("plugin"),
  violation_id: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return withCors(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return withCors(
      NextResponse.json(
        { error: "Invalid request", issues: sanitizeZodIssues(parsed.error.issues) },
        { status: 400 },
      ),
    );
  }

  // Same 60/min budget as /api/check. Override-spamming a single user
  // can't be allowed to skew the implicit-labeling signal.
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

  const {
    standard_id,
    text,
    moment,
    override_type,
    override_reason,
    source,
    violation_id,
  } = parsed.data;

  // Team scope mirrors violations: free/pro users have team_id=null;
  // team-plan users (member or owner) attribute to the OWNER's user.id
  // so per-team rollups are sensible.
  const teamId =
    auth.plan === "team"
      ? (auth.teamOwnerUserId ?? auth.user.id)
      : null;

  try {
    const db = getDb();
    const [row] = await db
      .insert(schema.violationOverrides)
      .values({
        teamId,
        userId: auth.user.id,
        violationId: violation_id ?? null,
        standardId: standard_id,
        moment: moment ?? null,
        textHash: hashText(text),
        overrideType: override_type,
        overrideReason: override_reason ?? null,
        source,
      })
      .returning();
    return withCors(
      NextResponse.json(envelope({ override: row }), { status: 201 }),
    );
  } catch (err) {
    console.error("violation override insert failed:", err);
    return withCors(
      NextResponse.json(
        { error: "Failed to record override" },
        { status: 500 },
      ),
    );
  }
}
