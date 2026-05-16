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
  deriveBanMatcher,
  nextCustomStandardId,
  type AddFields,
} from "@/lib/team-rules";
import { classifyTeamRule } from "@/lib/evaluate";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { logSafeError } from "@/lib/safe-error-log";
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
  // Optional (2026-05-15) — customer-facing regex was cut. A
  // pattern-less rule is prose-only. Patterns still validate when
  // present (a future ContentRX-derived ban will set this server-
  // side; the field stays in the schema for that path + back-compat
  // with existing patterned rows).
  pattern: z.string().min(1).max(500).optional(),
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
    const rj = parsed.data.rule_json;

    // PII / credential pre-screen. Project B newly sends the rule
    // prose to Anthropic (the save-time classifier), so this route now
    // handles a string headed to the engine — wire the guard exactly
    // as /api/check does (CLAUDE.md: any new engine-bound string route
    // pre-screens BEFORE Anthropic/Sentry/logs see it). The matched
    // value is never echoed back.
    const sensitive = detectSensitivePatterns(`${rj.title}\n${rj.rule}`);
    if (sensitive.length > 0) {
      return NextResponse.json(
        { error: sensitiveDataErrorMessage(sensitive), patterns: sensitive },
        { status: 400 },
      );
    }

    // Save-time classifier (Project B, 2026-05-15). Split the prose
    // into a deterministic-ban component and/or a stylistic one.
    // Asymmetric safe-failure: a transport / engine outage degrades to
    // a plain stylistic rule — it still saves, and the customer is
    // shown "Style guidance", never silently a mislabeled hard ban. An
    // *unparseable* classification already fails safe to stylistic
    // inside the engine without erroring (treat-as-stylistic: a
    // misclassification must never produce a false hard-enforcement).
    let classification:
      | Awaited<ReturnType<typeof classifyTeamRule>>["result"]
      | null = null;
    try {
      classification = (await classifyTeamRule(rj.rule, rj.title)).result;
    } catch (err) {
      logSafeError(
        "team-rule classify failed; saving as plain stylistic",
        err,
      );
    }

    // Derive the single server-authored matcher. The customer never
    // authors or sees a regex (#579 cut the field); deriveBanMatcher
    // is the ONE place a ban becomes one, and the stored pattern is
    // reused verbatim by the flag, the length-independent trigger, and
    // the post-pass rewrite detector. is_ban with no usable matcher ⇒
    // degrade to stylistic (never a tokenless hard ban).
    const derived =
      classification?.is_ban
        ? deriveBanMatcher(classification.ban_tokens)
        : null;
    const isHardBan = derived !== null;

    // The add path's stored ruleJson is fully SERVER-shaped. Any
    // customer-supplied `pattern` / `case_insensitive` is intentionally
    // dropped — the only pattern that may ever exist is the derived
    // one. This is the post-#579 contract: prose in, mechanism owned.
    const ruleJson: AddFields = {
      title: rj.title,
      rule: rj.rule,
      severity: rj.severity,
      ...(rj.content_types ? { content_types: rj.content_types } : {}),
      enforcement: isHardBan ? "hard_ban" : "style_guidance",
    };
    if (isHardBan && derived && classification) {
      ruleJson.pattern = derived.pattern;
      ruleJson.case_insensitive = derived.caseInsensitive;
      ruleJson.ban = {
        tokens: classification.ban_tokens.filter(
          (t) => typeof t === "string" && t.trim().length > 0,
        ),
        leaveProperNouns: classification.leave_proper_nouns === true,
      };
      // Mixed rule: the style clause rides the TIER 2 seam; the ban
      // rides the non-overridable TIER 1 region. Pure ban ⇒ no
      // stylistic_directive (nothing goes to TIER 2).
      const sd = (classification.stylistic_directive ?? "").trim();
      if (sd) ruleJson.stylistic_directive = sd;
    }

    const standardId = await nextCustomStandardId(teamOwnerUserId);
    const [row] = await db
      .insert(schema.teamRules)
      .values({
        teamOwnerUserId,
        standardId,
        action: "add",
        ruleJson,
      })
      .returning();
    revalidateDashboard({ teamId: teamOwnerUserId });
    // Surface the enforcement label so the customer SEES how their
    // rule is enforced ("Hard ban: …" vs "Style guidance"). The
    // rules-client rendering of this is the separate parked UX
    // cluster; persisting + returning the label is the in-scope half.
    return NextResponse.json(
      envelope({ rule: row, enforcement: ruleJson.enforcement }),
      { status: 201 },
    );
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
