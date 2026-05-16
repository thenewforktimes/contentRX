/**
 * POST /api/customer-flag — capture a customer's flag-for-review.
 *
 * The customer has clicked "Flag for review" on a check result and
 * given explicit consent to share the original text + verdict with
 * Robert. The flag opens a contribution channel that improves
 * rulesets and the model — the founder triages each flag in
 * /admin/customer-flags.
 *
 * Per ADR 2026-05-11, this is the ONLY path by which a customer
 * string enters ContentRX's calibration corpus. Override dismissals
 * are private hashes; this route is the explicit-share consent flow.
 *
 * Distinct from POST /api/violations/override:
 *   - Override: "I disagree with this finding." Stores text_hash only.
 *     Never plaintext.
 *   - Flag: "Please look at this." Plaintext is stored unconditionally
 *     because the existence of the flag implies consent. The customer
 *     ticks a consent box before the flag fires.
 *
 * Privacy contract:
 *   - The route MUST receive `consent: true`. Without it, the request
 *     400s. Never inferred.
 *   - Plaintext goes through the same `detectSensitivePatterns` screen
 *     as every other text-bearing route. A flag containing detected
 *     PII is rejected — ContentRX would rather lose the contribution
 *     than store credit cards.
 *   - The row carries `consent_recorded_at` for audit.
 *   - Per-entry display only on the admin surface — never aggregated,
 *     never default-on.
 *   - Customers can revoke a shared string by emailing
 *     privacy@contentrx.io.
 *
 * Auth: Clerk session OR Bearer cx_<api_key>. Same as /api/check.
 */

import { z } from "zod";
import { corsJson, corsPreflight } from "@/lib/cors";
import { resolveAuth } from "@/lib/auth";
import { hashText } from "@/lib/log-violations";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { checkRateLimit } from "@/lib/ratelimit";
import { logSafeError } from "@/lib/safe-error-log";
import { teamScope } from "@/lib/team-scope";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";
import { CONTENT_TYPES, MOMENTS } from "@/lib/engine-taxonomy";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

const RequestSchema = z.object({
  // Plaintext that was checked. Stored on consent.
  text: z.string().min(1).max(100_000),
  // Engine context at the moment of the flag — enum-validated against
  // the taxonomy so customer-flag rows can be filtered/aggregated on
  // the same values /api/check accepts. (Previously a free string,
  // which let arbitrary substrings into the substrate column visible
  // on /admin/customer-flags.)
  content_type: z.enum(CONTENT_TYPES).optional(),
  moment: z.enum(MOMENTS).optional(),
  verdict: z.enum(["pass", "violation", "review_recommended"]).optional(),
  // Optional pointer to an originating violation when the flag came
  // from a check that contained one. Null when the flag was on a pass
  // verdict (the customer thinks a finding SHOULD have fired).
  violation_id: z.string().min(1).max(64).optional(),
  // What the customer is asking ContentRX to look at — free-text from
  // the modal. Required (2026-05-13): the radio-button reason taxonomy
  // was retired in favour of the customer's own words because the
  // content designer's triage reads better from prose than from a
  // forced category. The modal gates submit until this is non-empty.
  customer_note: z.string().min(1).max(2000),
  source: z
    .enum(["dashboard", "cli", "action", "lsp", "mcp"])
    .default("dashboard"),
  // Hard requirement. The schema's existence on the row records
  // consent; the API requires it explicitly so the consent moment is
  // never inferred.
  consent: z.literal(true, {
    message:
      "Flagging requires consent. Set consent: true after the customer ticks the consent box.",
  }),
});

export async function POST(req: Request) {
  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);

  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return json({ error: auth.message }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "Invalid request",
        issues: sanitizeZodIssues(parsed.error.issues),
      },
      { status: 400 },
    );
  }

  // PII pre-screen on every text-bearing field. The customer's note
  // can also leak — screen it alongside the primary text.
  const sensitivePatterns = detectSensitivePatterns(
    [parsed.data.text, parsed.data.customer_note ?? ""].join("\n"),
  );
  if (sensitivePatterns.length > 0) {
    return json(
      {
        error: sensitiveDataErrorMessage(sensitivePatterns),
        patterns: sensitivePatterns,
      },
      { status: 400 },
    );
  }

  // Same 60/min budget as /api/check + /api/violations/override.
  // Flag-spamming a single account can't be allowed to skew the
  // founder's inbox.
  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    return json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    const db = getDb();
    const teamId = teamScope(auth);
    const [row] = await db
      .insert(schema.customerFlaggedReviews)
      .values({
        userId: auth.user.id,
        teamId,
        text: parsed.data.text,
        textHash: hashText(parsed.data.text),
        contentType: parsed.data.content_type ?? null,
        moment: parsed.data.moment ?? null,
        verdict: parsed.data.verdict ?? null,
        violationId: parsed.data.violation_id ?? null,
        customerNote: parsed.data.customer_note,
        source: parsed.data.source,
        // Audit trail: stamp consent at the write site instead of relying
        // on the schema's defaultNow(). If the default is ever dropped
        // the column would silently start storing NULL; an explicit value
        // here makes the consent moment load-bearing on the route, not
        // the schema.
        consentRecordedAt: new Date(),
      })
      .returning({ id: schema.customerFlaggedReviews.id });

    return json({ id: row?.id, ok: true }, { status: 201 });
  } catch (err) {
    logSafeError("[customer-flag] insert failed", err);
    return json(
      { error: "Could not record the flag. Try again in a moment." },
      { status: 500 },
    );
  }
}
