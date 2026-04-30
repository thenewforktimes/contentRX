/**
 * POST /api/violations/adjust — capture a customer's adjustment of a
 * finding from the dashboard's Adjust modal.
 *
 * Auth: Clerk session OR Bearer cx_<api_key>.
 *
 * Block 1c of the calibration plan. Distinct from
 * /api/violations/override (which is the substrate-aware override
 * stream used by the Figma plugin / CLI / GitHub Action — those
 * surfaces have `standard_id` available client-side).
 *
 * Why a separate route: per ADR 2026-04-25, the customer browser
 * NEVER sees `standard_id`. The Adjust modal sends the input text and
 * the proposed rewrite (if any), and the server correlates against
 * the violations table to recover substrate context (moment,
 * content_type, standard_id). The override route's required
 * standard_id contract is preserved for the plugin/CLI/Action callers
 * that genuinely have it.
 *
 * Body:
 *   {
 *     text: string,                                  // input the customer was checking
 *     signal_type: "verdict" | "suggestion" | "both",
 *     // Verdict path (signal_type ∋ "verdict"):
 *     override_reason_code?: enum,
 *     override_notes?: string,
 *     // Suggestion path (signal_type ∋ "suggestion"):
 *     rewrite_text?: string,
 *     // Common:
 *     issue?: string,                                // public-envelope issue text, used for clustering
 *     share_upstream: boolean,                       // default FALSE per ADR 2026-04-28
 *   }
 *
 * Privacy:
 *   - Every text field PII-screened before any DB write
 *     (src/lib/pii-screen.ts).
 *   - share_upstream defaults FALSE; rows are team-private until the
 *     customer explicitly opts in.
 *   - text is sha256-hashed; the raw input never persists.
 *   - rewrite_text persists in plaintext on suggestion_candidates
 *     (Robert needs to read it during /admin triage), but only when
 *     the customer opted in via share_upstream OR when the team is
 *     the only consumer (sourceTeamOwnerUserId is set).
 *
 * Substrate correlation:
 *   The server looks up the most recent `violations` row matching
 *   (userId, textHash). When found, the substrate fields (moment,
 *   contentType, standardId) propagate to violation_overrides and
 *   suggestion_candidates rows. When not found (race, deletion), the
 *   substrate fields stay nullable and Robert's /admin triage backfills.
 */

import { and, desc, eq } from "drizzle-orm";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { hashText } from "@/lib/log-violations";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { checkRateLimit } from "@/lib/ratelimit";
import { logSafeError } from "@/lib/safe-error-log";
import { revalidateDashboard } from "@/lib/revalidate";
import { teamScope } from "@/lib/team-scope";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

import { corsJson, corsPreflight } from "@/lib/cors";
import { RequestSchema } from "./schema";

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

  // PII pre-screen — every text field gets checked before persistence.
  // Defense-in-depth: even a customer who opts in to share_upstream
  // shouldn't accidentally leak PII into Robert's triage queue.
  const candidates = [
    parsed.data.text,
    parsed.data.rewrite_text ?? "",
    parsed.data.override_notes ?? "",
    parsed.data.issue ?? "",
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

  // Same 60/min budget as /api/check + /api/violations/override.
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
    text,
    signal_type,
    override_reason_code,
    override_notes,
    rewrite_text,
    issue,
    share_upstream,
  } = parsed.data;

  const teamId = teamScope(auth);
  const textHash = hashText(text);
  const wantsVerdict = signal_type === "verdict" || signal_type === "both";
  const wantsSuggestion = signal_type === "suggestion" || signal_type === "both";

  try {
    const db = getDb();

    // Server-side correlation: pull the most recent violations row
    // matching (userId, textHash) so we recover substrate context
    // without exposing it to the customer browser. Nullable because
    // the lookup may miss (race with violation deletion, or the user
    // adjusting a stale finding card after their /api/check row
    // expired). Robert's /admin triage backfills when this is null.
    const correlated = await db
      .select({
        moment: schema.violations.moment,
        contentType: schema.violations.contentType,
        standardId: schema.violations.standardId,
        violationId: schema.violations.id,
      })
      .from(schema.violations)
      .where(
        and(
          eq(schema.violations.userId, auth.user.id),
          eq(schema.violations.textHash, textHash),
        ),
      )
      .orderBy(desc(schema.violations.createdAt))
      .limit(1);

    const substrate = correlated[0] ?? {
      moment: null,
      contentType: null,
      standardId: null,
      violationId: null,
    };

    // Verdict path — write to violation_overrides. We require a
    // standardId in this table; if correlation missed, skip the
    // verdict write (the suggestion-path write below still goes
    // through; Robert can correct manually).
    if (wantsVerdict && substrate.standardId) {
      await db.insert(schema.violationOverrides).values({
        teamId,
        userId: auth.user.id,
        violationId: substrate.violationId,
        standardId: substrate.standardId,
        moment: substrate.moment,
        textHash,
        overrideType: "dismiss",
        overrideReason: override_notes ?? null,
        source: "dashboard",
        overrideStance: "disagree",
        overrideReasonCode: override_reason_code ?? null,
        // Corpus-loop opt-in (Session 8). Carry the same
        // `share_upstream` consent that suggestion_candidates uses
        // through to violation_overrides so the founder can triage
        // the row to `addressed_corpus` from /admin/overrides.
        // Text is already PII-screened above; default false means
        // only `text_hash` lands.
        contributeUpstream: share_upstream,
        text: share_upstream ? text : null,
      });
    }

    // Suggestion path — write to suggestion_candidates. The bucket
    // axes (moment, contentType, standardId) are nullable; correlation
    // populates when found, /admin triage backfills otherwise.
    if (wantsSuggestion && rewrite_text) {
      await db.insert(schema.suggestionCandidates).values({
        moment: substrate.moment,
        contentType: substrate.contentType,
        standardId: substrate.standardId,
        source: "customer_rewrite",
        sourceUserId: auth.user.id,
        sourceTeamOwnerUserId: teamId,
        inputHash: textHash,
        candidateText: rewrite_text,
        issueContext: issue ?? null,
        shareUpstream: share_upstream,
        status: "pending",
      });
    }

    revalidateDashboard({ teamId });

    return json(
      envelope({
        recorded: {
          verdict: wantsVerdict && Boolean(substrate.standardId),
          suggestion: wantsSuggestion && Boolean(rewrite_text),
        },
      }),
      { status: 201 },
    );
  } catch (err) {
    logSafeError("violation adjust insert failed", err);
    return json({ error: "Failed to record adjustment" }, { status: 500 });
  }
}
