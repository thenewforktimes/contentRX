/**
 * POST /api/team-rules/preview — dry-run a proposed rule change.
 *
 * BUILD_PLAN_v2 Session 12. Before a team owner commits a
 * disable/override/add rule, compute what the change would do on
 * the last N days of team history and return the diff. The UI
 * surfaces this inline so the commit button only enables after the
 * owner sees the blast radius.
 *
 * Auth: Clerk-session only (no Bearer) — this is a dashboard
 * surface, not an API for programmatic callers. Team-plan only.
 * Owner-only (same gate as POST /api/team-rules).
 *
 * Privacy: reads historical `violations` rows that already store
 * `text_hash` + aggregate fields. No plaintext crosses the wire in
 * either direction.
 */

import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import {
  buildRulePreview,
  DEFAULT_SAMPLE_CAP,
  type HistoricalViolationRow,
  type ProposedRuleChange,
} from "@/lib/rule-preview";
import { corsJson, corsPreflight } from "@/lib/cors";
import { checkRateLimit } from "@/lib/ratelimit";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

const DAY_MS = 24 * 60 * 60 * 1000;

const WindowSchema = z
  .enum(["7d", "14d", "30d", "60d", "90d"])
  .default("30d");

const ProposedChangeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("disable"),
    standard_id: z.string().min(1).max(32),
  }),
  z.object({
    action: z.literal("override"),
    standard_id: z.string().min(1).max(32),
    override: z
      .object({
        rule: z.string().max(2000).optional(),
        severity: z.string().max(64).optional(),
        title: z.string().max(200).optional(),
      })
      .default({}),
  }),
  z.object({
    action: z.literal("add"),
    standard_id: z.string().min(1).max(32),
  }),
]);

const RequestSchema = z.object({
  change: ProposedChangeSchema,
  window: WindowSchema.optional(),
});

function windowDays(w: string | undefined): number {
  switch (w) {
    case "7d":
      return 7;
    case "14d":
      return 14;
    case "60d":
      return 60;
    case "90d":
      return 90;
    case "30d":
    default:
      return 30;
  }
}

export async function POST(req: Request) {
  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return json({ error: auth.message }, { status: auth.status });
  }
  if (auth.plan !== "team") {
    return json(
      { error: "Rule previews are available on the Team plan." },
      { status: 403 },
    );
  }
  // Owner-only — mirrors POST /api/team-rules. `teamOwnerUserId` is
  // null for the owner's own user row.
  if (auth.teamOwnerUserId !== null) {
    return json(
      { error: "Only the team owner can preview rule changes." },
      { status: 403 },
    );
  }

  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    return json({ error: "Rate limit exceeded" }, { status: 429 });
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
  const { change, window } = parsed.data;
  const days = windowDays(window);
  const teamId = auth.user.id; // owner's user id is the team id
  const since = new Date(Date.now() - days * DAY_MS);

  const db = getDb();
  const rows = await db
    .select({
      id: schema.violations.id,
      standardId: schema.violations.standardId,
      severity: schema.violations.severity,
      moment: schema.violations.moment,
      contentType: schema.violations.contentType,
      textHash: schema.violations.textHash,
      createdAt: schema.violations.createdAt,
    })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamId),
        gte(schema.violations.createdAt, since),
      ),
    );

  const violations: HistoricalViolationRow[] = rows.map((r) => ({
    id: r.id,
    standardId: r.standardId,
    severity: r.severity,
    moment: r.moment,
    contentType: r.contentType,
    textHash: r.textHash,
    createdAt: r.createdAt,
  }));

  const preview = buildRulePreview({
    change: change as ProposedRuleChange,
    violations,
    sampleCap: DEFAULT_SAMPLE_CAP,
  });

  return json(
    envelope({
      result: preview.result,
      window: `${days}d`,
      schema_version: preview.schema_version,
    }),
  );
}
