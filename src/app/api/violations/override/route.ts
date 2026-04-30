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
 *     source?: "plugin" | "cli" | "action" | "dashboard" | "lsp",  // default "plugin"
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

import { z } from "zod";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { MOMENTS } from "@/lib/engine-taxonomy";
import { hashText } from "@/lib/log-violations";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { checkRateLimit } from "@/lib/ratelimit";
import { logSafeError } from "@/lib/safe-error-log";
import { revalidateDashboard } from "@/lib/revalidate";
import { isKnownStandardId } from "@/lib/standards";
import { teamScope } from "@/lib/team-scope";
import { CUSTOM_STANDARD_ID_REGEX } from "@/lib/team-rules";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

import { corsJson, corsPreflight } from "@/lib/cors";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

// standard_id must be either a known built-in standard (e.g. "ACT-01",
// "TON-12") or a team-custom standard matching `CUSTOM_STANDARD_ID_REGEX`
// (TEAM-NN). Anything else is junk that would poison override
// analytics — closes audit H-06.
function isValidStandardId(id: string): boolean {
  return isKnownStandardId(id) || CUSTOM_STANDARD_ID_REGEX.test(id);
}

const RequestSchema = z.object({
  standard_id: z
    .string()
    .min(1)
    .max(64)
    .refine(isValidStandardId, {
      message:
        "standard_id must be a known engine standard (e.g. ACT-01) or a TEAM-NN custom standard",
    }),
  // Same 100k cap as /api/check so a malicious body can't blow up the
  // SHA pipeline. Text is hashed and discarded — never persisted.
  text: z.string().min(1).max(100_000),
  moment: z.enum(MOMENTS).optional(),
  override_type: z.enum(["dismiss", "accept_as_review", "mark_false_positive"]),
  override_reason: z.string().min(1).max(500).optional(),
  source: z.enum(["plugin", "cli", "action", "dashboard", "lsp", "mcp"]).default("plugin"),
  violation_id: z.string().min(1).max(64).optional(),
  // Human-eval build plan Session 3 additions. All optional — pre-
  // Session-3 clients keep working without supplying any of these.
  override_stance: z.enum(["agree", "disagree", "agree_but_overriding"]).optional(),
  actor_role: z.enum(["designer", "engineer", "pm", "other"]).optional(),
  rationale_expanded: z.boolean().optional(),
  // Practical upper bound: an hour in ms. Anything longer is almost
  // certainly the user walking away — stop capturing once the tab
  // has been idle that long.
  time_to_action_ms: z.number().int().min(0).max(3_600_000).optional(),
  // Counterfactual triple: original text hash already lives in
  // `text_hash` (server-hashed from `text`). These two are the
  // tool's suggestion and what the user actually applied, also
  // hashed client-side (same sha256 contract as `text`).
  suggested_text: z.string().min(1).max(100_000).optional(),
  applied_text: z.string().min(1).max(100_000).optional(),
  // Human-eval build plan Session 4 — structured reason vocabulary +
  // session grouping. Reason code is independent of override_stance:
  // a user who picks "disagree" usually supplies a reason code; one
  // who picks "agree" typically doesn't. Enforced client-side, not
  // gated server-side — we always accept whatever is sent.
  override_reason_code: z
    .enum([
      "not_applicable_here",
      "standard_too_strict",
      "fix_is_worse",
      "shipping_anyway",
      "confusing_need_more_context",
    ])
    .optional(),
  // Free-form session ID from the client. Figma plugin uses one per
  // scan; CLI/CI could use the run ID; dashboard could use a per-tab
  // UUID. Session 4 aggregates by this on read.
  session_id: z.string().min(1).max(64).optional(),
  // Corpus-loop consent (Session 8, post-launch). When the pilot
  // explicitly opts in to share this dismissal with calibration, the
  // raw text is captured (after the same PII pre-screen as the rest
  // of the request) so the founder can triage it into the private
  // corpus at /admin/overrides. Default false; never inferred. When
  // false, only `text_hash` lands and the row can't be triaged to
  // `addressed_corpus`.
  contribute_upstream: z.boolean().optional().default(false),
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
      { error: "Invalid request", issues: sanitizeZodIssues(parsed.error.issues) },
      { status: 400 },
    );
  }

  // PII pre-screen — refuse credentials and PII on the override path
  // too. The text gets sha256-hashed before storage, but it transits
  // the engine for context-recovery, so the upstream rules apply.
  // Suggested/applied text is screened with the primary text. See
  // `lib/pii-screen.ts`.
  const candidates = [
    parsed.data.text,
    parsed.data.suggested_text ?? "",
    parsed.data.applied_text ?? "",
  ].join("\n");
  const sensitivePatterns = detectSensitivePatterns(candidates);
  if (sensitivePatterns.length > 0) {
    return json(
      {
        error: sensitiveDataErrorMessage(sensitivePatterns),
        patterns: sensitivePatterns,
      },
      { status: 400 },
    );
  }

  // Same 60/min budget as /api/check. Override-spamming a single user
  // can't be allowed to skew the implicit-labeling signal.
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

  const {
    standard_id,
    text,
    moment,
    override_type,
    override_reason,
    source,
    violation_id,
    override_stance,
    actor_role,
    rationale_expanded,
    time_to_action_ms,
    suggested_text,
    applied_text,
    override_reason_code,
    session_id,
    contribute_upstream,
  } = parsed.data;

  // team_id always equals "team-owner-or-self" (lib/team-scope.ts).
  // Pre-PR-198 this route wrote `team_id = null` for free/Pro users,
  // matching /api/check's old behavior — both flipped together so
  // override-report reads + violation reads always agree.
  const teamId = teamScope(auth);

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
        overrideStance: override_stance ?? null,
        actorRole: actor_role ?? null,
        rationaleExpanded: rationale_expanded ?? null,
        timeToActionMs: time_to_action_ms ?? null,
        suggestedTextHash: suggested_text ? hashText(suggested_text) : null,
        appliedTextHash: applied_text ? hashText(applied_text) : null,
        overrideReasonCode: override_reason_code ?? null,
        sessionId: session_id ?? null,
        // Corpus-loop opt-in. Text is only retained when the pilot
        // explicitly checked the consent box at dismiss time. The
        // PII pre-screen above already ran on this same string;
        // sentinel-shaped credentials and PII can't reach storage.
        contributeUpstream: contribute_upstream,
        text: contribute_upstream ? text : null,
      })
      .returning();
    // Override report at /dashboard/overrides reads from this table.
    // Override count surfaces in the "This week" insights panel too,
    // so bust the team's violations tag.
    revalidateDashboard({ teamId });
    return json(envelope({ override: row }), { status: 201 });
  } catch (err) {
    logSafeError("violation override insert failed", err);
    return json({ error: "Failed to record override" }, { status: 500 });
  }
}
