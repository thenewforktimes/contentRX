/**
 * GET    /api/team-rules — list the caller's team rules
 * POST   /api/team-rules — create a disable / override / add rule
 *
 * Only the team-plan OWNER (not team members) can write rules.
 * Writes are denied with 403 for non-owners even if they're on the
 * team plan. Members can still GET so the UI can render the same
 * read-only view they'd see in the plugin.
 *
 * The Stripe subscription gates whether the team plan is active; if
 * it isn't, creating a rule returns 402 so the dashboard can route
 * the user to /dashboard to upgrade.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { getDb, schema } from "@/db";
import {
  CUSTOM_STANDARD_ID_REGEX,
  findReDoSConcern,
  nextCustomStandardId,
} from "@/lib/team-rules";
import { enforceRateLimit } from "@/lib/ratelimit";
import { revalidateDashboard } from "@/lib/revalidate";
import { isKnownStandardId } from "@/lib/standards";
import { sanitizeZodIssues } from "@/lib/zod-errors";

const OverrideFieldsSchema = z
  .object({
    rule: z.string().min(1).max(2000).optional(),
    severity: z.enum(["low", "medium", "high"]).optional(),
    title: z.string().min(1).max(200).optional(),
  })
  .refine(
    (v) => v.rule !== undefined || v.severity !== undefined || v.title !== undefined,
    { message: "Provide at least one field to override" },
  );

const AddFieldsSchema = z.object({
  title: z.string().min(1).max(200),
  rule: z.string().min(1).max(2000),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  pattern: z.string().min(1).max(500),
  case_insensitive: z.boolean().optional(),
  content_types: z.array(z.string().max(50)).max(8).optional(),
});

const CreateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("disable"),
    standard_id: z.string(),
  }),
  z.object({
    action: z.literal("override"),
    standard_id: z.string(),
    rule_json: OverrideFieldsSchema,
  }),
  z.object({
    action: z.literal("add"),
    rule_json: AddFieldsSchema,
  }),
]);

export async function GET(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (auth.plan !== "team") {
    return NextResponse.json(envelope({ rules: [] }));
  }

  const ownerId = auth.teamOwnerUserId ?? auth.user.id;
  const db = getDb();
  const rules = await db
    .select()
    .from(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, ownerId));

  return NextResponse.json(
    envelope({ rules, is_admin: auth.teamOwnerUserId === null }),
  );
}

export async function POST(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (auth.plan !== "team") {
    return NextResponse.json(
      { error: "Editing team rules is available on the Team plan." },
      { status: 402 },
    );
  }
  if (auth.teamOwnerUserId !== null) {
    // Not the owner — this user is a team member, can't write.
    return NextResponse.json(
      { error: "Only the team owner can edit rules" },
      { status: 403 },
    );
  }

  const rl = await enforceRateLimit(auth.user.id);
  if (rl) return rl;

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: sanitizeZodIssues(parsed.error.issues) },
      { status: 400 },
    );
  }

  const db = getDb();
  const teamOwnerUserId = auth.user.id;

  if (parsed.data.action === "add") {
    // Validate the regex is compilable up front so a broken pattern
    // doesn't silently live in the DB and skip every evaluation.
    try {
      new RegExp(parsed.data.rule_json.pattern);
    } catch (err) {
      return NextResponse.json(
        { error: "Invalid regex pattern", detail: String(err) },
        { status: 400 },
      );
    }
    // ReDoS guard — reject obvious catastrophic-backtracking shapes
    // so one admin can't self-DoS their team's /api/check path.
    const redos = findReDoSConcern(parsed.data.rule_json.pattern);
    if (redos) {
      return NextResponse.json(
        { error: redos },
        { status: 400 },
      );
    }
    const standardId = await nextCustomStandardId(teamOwnerUserId);
    const [row] = await db
      .insert(schema.teamRules)
      .values({
        teamOwnerUserId,
        standardId,
        action: "add",
        ruleJson: parsed.data.rule_json,
      })
      .returning();
    revalidateDashboard({ teamId: teamOwnerUserId });
    return NextResponse.json(envelope({ rule: row }), { status: 201 });
  }

  const standardId = parsed.data.standard_id;
  if (!CUSTOM_STANDARD_ID_REGEX.test(standardId) && !isKnownStandardId(standardId)) {
    return NextResponse.json(
      { error: `Unknown standard_id: ${standardId}` },
      { status: 400 },
    );
  }

  if (parsed.data.action === "disable") {
    const [row] = await db
      .insert(schema.teamRules)
      .values({
        teamOwnerUserId,
        standardId,
        action: "disable",
        ruleJson: {},
      })
      .onConflictDoUpdate({
        target: [
          schema.teamRules.teamOwnerUserId,
          schema.teamRules.standardId,
          schema.teamRules.action,
        ],
        set: { updatedAt: new Date() },
      })
      .returning();
    revalidateDashboard({ teamId: teamOwnerUserId });
    return NextResponse.json(envelope({ rule: row }), { status: 201 });
  }

  // override
  const [row] = await db
    .insert(schema.teamRules)
    .values({
      teamOwnerUserId,
      standardId,
      action: "override",
      ruleJson: parsed.data.rule_json,
    })
    .onConflictDoUpdate({
      target: [
        schema.teamRules.teamOwnerUserId,
        schema.teamRules.standardId,
        schema.teamRules.action,
      ],
      set: { ruleJson: parsed.data.rule_json, updatedAt: new Date() },
    })
    .returning();
  revalidateDashboard({ teamId: teamOwnerUserId });
  return NextResponse.json(envelope({ rule: row }), { status: 201 });
}
