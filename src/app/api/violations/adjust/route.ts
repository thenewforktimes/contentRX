/**
 * POST /api/violations/adjust — capture a customer's adjustment of a
 * finding from the dashboard's Adjust modal.
 *
 * Auth: Clerk session OR Bearer cx_<api_key>.
 *
 * Distinct from /api/violations/override (which is the substrate-aware
 * override stream used by the Figma plugin / CLI / GitHub Action — those
 * surfaces have `standard_id` available client-side).
 *
 * Why a separate route: per ADR 2026-04-25, the customer browser
 * NEVER sees `standard_id`. The Adjust modal sends the input text and
 * the proposed rewrite (if any), and the server correlates against
 * the violations table to recover substrate context (moment,
 * content_type, standard_id).
 *
 * Per ADR 2026-05-11 the route no longer carries a calibration-share
 * payload. Adjustments are a private record of the customer's own
 * dismissals. To share a string with the calibration corpus, customers
 * use the separate Flag-for-Review consent flow (/api/customer-flag).
 *
 * Body:
 *   {
 *     text: string,
 *     signal_type: "verdict" | "suggestion" | "both",
 *     override_reason_code?: enum,
 *     override_notes?: string,
 *     rewrite_text?: string,
 *     issue?: string,
 *   }
 *
 * Privacy:
 *   - Every text field PII-screened before any DB write.
 *   - text is sha256-hashed; the raw input never persists.
 *   - rewrite_text is never persisted by this route.
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
  const candidates = [
    parsed.data.text,
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

  const { text, override_reason_code, override_notes } = parsed.data;

  const teamId = teamScope(auth);
  const textHash = hashText(text);

  try {
    const db = getDb();

    // Server-side correlation: pull the most recent violations row
    // matching (userId, textHash) so we recover substrate context
    // without exposing it to the customer browser. Nullable because
    // the lookup may miss (race with violation deletion, or the user
    // adjusting a stale finding card after their /api/check row
    // expired).
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

    // Write to violation_overrides as a private record of the
    // customer's own dismissal. Per ADR 2026-05-11 nothing here
    // feeds the calibration corpus. Corpus contributions come through
    // the separate Flag-for-Review consent flow.
    const recorded = Boolean(substrate.standardId);
    if (recorded) {
      await db.insert(schema.violationOverrides).values({
        teamId,
        userId: auth.user.id,
        violationId: substrate.violationId,
        standardId: substrate.standardId as string,
        moment: substrate.moment,
        textHash,
        overrideType: "dismiss",
        overrideReason: override_notes ?? null,
        source: "dashboard",
        overrideStance: "disagree",
        overrideReasonCode: override_reason_code,
      });
    }

    revalidateDashboard({ teamId });

    return json(
      envelope({ recorded: { verdict: recorded } }),
      { status: 201 },
    );
  } catch (err) {
    logSafeError("violation adjust insert failed", err);
    return json({ error: "Failed to record adjustment" }, { status: 500 });
  }
}
