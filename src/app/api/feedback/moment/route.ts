/**
 * POST /api/feedback/moment — capture a customer's moment-misdetection
 * correction.
 *
 * The customer-facing surfaces (Figma plugin's moment banner, the
 * dashboard's check detail) show the detected moment alongside each
 * check — e.g., "Detected as: destructive_action". The "Not
 * <moment>?" button next to that banner POSTs here so the customer
 * can flag the classifier got it wrong.
 *
 * The row persists into `rationale_feedback` with `correction_type =
 * situation_ambiguity` so the founder's review queue and any future
 * moment-classifier retraining can aggregate them. The DB table
 * keeps the historical name (`rationale_feedback`) because it
 * predates the schema 2.0.0 substrate strip; the URL was renamed in
 * the 2026-05-11 cruft cleanup from `/api/feedback/rationale` once
 * the rationale-chain corrections it originally accepted were
 * removed per ADR 2026-04-25.
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

import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { corsJson, corsPreflight } from "@/lib/cors";
import { RationaleFeedbackRequestSchema } from "@/lib/rationale-feedback";
import { checkRateLimit } from "@/lib/ratelimit";
import { teamScope } from "@/lib/team-scope";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

export async function POST(req: Request) {
  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);

  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return json({ error: auth.message }, { status: auth.status });
  }

  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    return json(
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
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RationaleFeedbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "Invalid request",
        issues: sanitizeZodIssues(parsed.error.issues),
      },
      { status: 400 },
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

  // Every team-scoped table writer uses teamScope(auth) so readers can
  // join on a non-null team_id. The free/Pro path used to land NULL
  // here, which made calibration / refinement-log aggregations silently
  // miss every rationale-feedback row from non-Team plans (same bug
  // class as the violations.team_id fix in PR-198).
  const teamIdForFeedback = teamScope(auth);

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

  return json(
    envelope({
      result: {
        ok: true,
        id: row?.id ?? null,
        correction_type,
        hop_step,
      },
    }),
  );
}
