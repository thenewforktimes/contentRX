/**
 * GET  /api/team-custom-examples         — list the team's entries.
 * POST /api/team-custom-examples         — create one.
 * GET  /api/team-custom-examples?text=X  — search by normalized text.
 *
 * Human-eval build plan Session 30. Authenticated. Team-plan only.
 * Admin-only (the team owner, mirrored from `team_rules`). MCP tools
 * and the CLI hit this endpoint; the web audit UI reads it read-only.
 *
 * Privacy: `text` is plaintext (team-authored). Nothing here leaks a
 * user's input — the feature is a team-owned decision list.
 */

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import {
  CUSTOM_EXAMPLES_CAP_PER_TEAM,
  countExamplesForTeam,
  normalizeText,
} from "@/lib/custom-examples";
import {
  CreateExampleRequestSchema,
} from "@/lib/custom-examples-schemas";
import { corsJson, corsPreflight } from "@/lib/cors";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { checkRateLimit } from "@/lib/ratelimit";
import { logSafeError } from "@/lib/safe-error-log";
import { revalidateDashboard } from "@/lib/revalidate";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

/**
 * Resolve the caller to a team-admin scope, or return an error
 * response. Used by every endpoint in this surface. Per Position-3
 * (Apr 2026): any team member can manage custom examples — there
 * is no admin role. The team owner is just the billing contact.
 */
async function requireTeamMember(
  req: Request,
): Promise<
  { teamOwnerUserId: string; actorUserId: string } | NextResponse
> {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return corsJson(req, { error: auth.message }, { status: auth.status });
  }
  if (auth.plan !== "team") {
    return corsJson(
      req,
      { error: "Custom examples are available on the Team plan." },
      { status: 403 },
    );
  }
  // teamOwnerUserId is null for the team owner, set for members.
  // Resolve to the team's effective id either way.
  const teamOwnerUserId = auth.teamOwnerUserId ?? auth.user.id;
  return { teamOwnerUserId, actorUserId: auth.user.id };
}

export async function GET(req: Request) {
  const authOrRes = await requireTeamMember(req);
  if (authOrRes instanceof NextResponse) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);

  const rl = await checkRateLimit(teamOwnerUserId);
  if (!rl.success) {
    return json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const url = new URL(req.url);
  const searchText = url.searchParams.get("text");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(500, Math.max(1, Number(limitParam))) : 50;

  const db = getDb();
  const whereClauses = [
    eq(schema.teamCustomExamples.teamOwnerUserId, teamOwnerUserId),
  ];
  if (searchText) {
    whereClauses.push(
      eq(schema.teamCustomExamples.normalizedText, normalizeText(searchText)),
    );
  }

  const rows = await db
    .select()
    .from(schema.teamCustomExamples)
    .where(and(...whereClauses))
    .orderBy(desc(schema.teamCustomExamples.createdAt))
    .limit(limit);

  return json(
    envelope({
      result: {
        examples: rows,
        count: rows.length,
        cap: CUSTOM_EXAMPLES_CAP_PER_TEAM,
      },
    }),
  );
}

export async function POST(req: Request) {
  const authOrRes = await requireTeamMember(req);
  if (authOrRes instanceof NextResponse) return authOrRes;
  const { teamOwnerUserId, actorUserId } = authOrRes;

  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);

  const rl = await checkRateLimit(teamOwnerUserId);
  if (!rl.success) {
    return json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateExampleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "Invalid request",
        issues: sanitizeZodIssues(parsed.error.issues),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // PII pre-screen — custom examples persist their `text` raw in the
  // database (we need it for the short-circuit lookup). That makes
  // them a long-term storage liability if they contain credentials
  // or PII. Refuse the insert here so the bad data never lands.
  // See `lib/pii-screen.ts`.
  const sensitivePatterns = detectSensitivePatterns(data.text);
  if (sensitivePatterns.length > 0) {
    return json(
      {
        error: sensitiveDataErrorMessage(sensitivePatterns),
        patterns: sensitivePatterns,
      },
      { status: 400 },
    );
  }

  // verdict=violation requires standard_id (an entry that asserts
  // "this fails" is useless without naming the standard it fails
  // against). verdict=pass requires standard_id to be empty.
  if (data.verdict === "violation" && !data.standard_id) {
    return json(
      { error: "verdict=violation entries require standard_id." },
      { status: 400 },
    );
  }
  if (data.verdict === "pass" && data.standard_id) {
    return json(
      {
        error:
          "verdict=pass entries don't accept standard_id. The pass applies globally.",
      },
      { status: 400 },
    );
  }

  // Cap check: fetch count first to avoid inserting past the limit.
  const currentCount = await countExamplesForTeam(teamOwnerUserId);
  if (currentCount >= CUSTOM_EXAMPLES_CAP_PER_TEAM) {
    return json(
      {
        error: `Team has reached the custom-examples cap (${CUSTOM_EXAMPLES_CAP_PER_TEAM}). Delete unused entries to make room.`,
        cap: CUSTOM_EXAMPLES_CAP_PER_TEAM,
        current: currentCount,
      },
      { status: 409 },
    );
  }

  const normalized = normalizeText(data.text);
  const db = getDb();

  try {
    const [row] = await db
      .insert(schema.teamCustomExamples)
      .values({
        teamOwnerUserId,
        createdByUserId: actorUserId,
        text: data.text,
        normalizedText: normalized,
        verdict: data.verdict,
        moment: data.moment ?? null,
        contentType: data.content_type ?? null,
        standardId: data.standard_id ?? null,
        notes: data.notes ?? null,
        contributeUpstream: data.contribute_upstream,
      })
      .returning();

    // Custom-examples surface at /dashboard/team/custom-examples.
    revalidateDashboard();
    return json(envelope({ result: { example: row } }), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Uniqueness collision — the (team, normalized_text) index
    // rejected because an entry for the same normalized text
    // already exists. Surface a friendly error rather than a 500.
    if (/team_custom_examples_team_text_unique/i.test(msg)) {
      return json(
        {
          error:
            "A custom example for this text already exists. Delete the existing entry first if you want to replace it.",
          normalized_text: normalized,
        },
        { status: 409 },
      );
    }
    logSafeError("POST /api/team-custom-examples failed", err);
    return json(
      { error: "Failed to create custom example." },
      { status: 500 },
    );
  }
}
