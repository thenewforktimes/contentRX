/**
 * PATCH  /api/team-rules/[id] — update rule_json on an existing rule
 * DELETE /api/team-rules/[id] — remove a rule
 *
 * Scoped by rule row id (cuid), not by standard_id, so there's a
 * single unambiguous target even when a team has multiple rule rows
 * pointing at the same standard (disable + override of GRM-03).
 *
 * Ownership check: the rule's team_owner_user_id must match the
 * caller's user.id. Otherwise 404 — we don't tell you whether the id
 * exists on another team.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { resolveAuth } from "@/lib/auth";
import { findReDoSConcern } from "@/lib/team-rules";

const OverrideFieldsSchema = z.object({
  rule: z.string().min(1).max(2000).optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  title: z.string().min(1).max(200).optional(),
});

const AddFieldsSchema = z.object({
  title: z.string().min(1).max(200),
  rule: z.string().min(1).max(2000),
  severity: z.enum(["low", "medium", "high"]),
  pattern: z.string().min(1).max(500),
  case_insensitive: z.boolean().optional(),
  content_types: z.array(z.string().max(50)).max(8).optional(),
});

const PatchSchema = z.object({
  rule_json: z.unknown(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (auth.plan !== "team" || auth.teamOwnerUserId !== null) {
    return NextResponse.json(
      { error: "Only the team owner can edit rules" },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.teamRules)
    .where(eq(schema.teamRules.id, id))
    .limit(1);

  if (!existing || existing.teamOwnerUserId !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Different rule actions validate rule_json differently — disable
  // rules can't be patched (nothing to edit), so redirect the caller
  // to DELETE instead.
  if (existing.action === "disable") {
    return NextResponse.json(
      { error: "Disable rules have no editable fields. DELETE to remove." },
      { status: 400 },
    );
  }

  const schemaForAction =
    existing.action === "override" ? OverrideFieldsSchema : AddFieldsSchema;
  const fieldsParsed = schemaForAction.safeParse(parsed.data.rule_json);
  if (!fieldsParsed.success) {
    return NextResponse.json(
      { error: "Invalid rule fields", issues: fieldsParsed.error.issues },
      { status: 400 },
    );
  }

  if (existing.action === "add") {
    const pattern = (fieldsParsed.data as { pattern: string }).pattern;
    try {
      new RegExp(pattern);
    } catch (err) {
      return NextResponse.json(
        { error: "Invalid regex pattern", detail: String(err) },
        { status: 400 },
      );
    }
    const redos = findReDoSConcern(pattern);
    if (redos) {
      return NextResponse.json({ error: redos }, { status: 400 });
    }
  }

  const [row] = await db
    .update(schema.teamRules)
    .set({ ruleJson: fieldsParsed.data, updatedAt: new Date() })
    .where(eq(schema.teamRules.id, id))
    .returning();

  return NextResponse.json({ rule: row });
}

export async function DELETE(req: Request, context: RouteContext) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (auth.plan !== "team" || auth.teamOwnerUserId !== null) {
    return NextResponse.json(
      { error: "Only the team owner can edit rules" },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.teamRules.id, owner: schema.teamRules.teamOwnerUserId })
    .from(schema.teamRules)
    .where(eq(schema.teamRules.id, id))
    .limit(1);

  if (!existing || existing.owner !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(schema.teamRules).where(eq(schema.teamRules.id, id));
  return NextResponse.json({ ok: true });
}
