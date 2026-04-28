/**
 * GET    /api/team-custom-examples/[id]  — fetch one entry.
 * PATCH  /api/team-custom-examples/[id]  — update notes / contribute_upstream.
 * DELETE /api/team-custom-examples/[id]  — remove.
 *
 * Human-eval build plan Session 30. Companion to
 * `src/app/api/team-custom-examples/route.ts`. Same auth model:
 * Team-plan team-owner only.
 *
 * What's intentionally NOT updatable: `text`, `verdict`, `moment`,
 * `content_type`, `standard_id`. Changing what the entry matches
 * would require re-normalisation + re-indexing and muddles the audit
 * trail. Deleting + re-creating is the right workflow — and the cap
 * makes that cheap.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { corsJson, corsPreflight } from "@/lib/cors";
import { UpdateExampleRequestSchema } from "@/lib/custom-examples-schemas";
import { checkRateLimit } from "@/lib/ratelimit";
import { revalidateDashboard } from "@/lib/revalidate";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

type Params = { id: string };

async function requireTeamMember(
  req: Request,
): Promise<{ teamOwnerUserId: string } | NextResponse> {
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
  // Per Position-3 (Apr 2026): any team member can manage. Resolve
  // teamId from teamOwnerUserId (members) or user.id (owners).
  const teamOwnerUserId = auth.teamOwnerUserId ?? auth.user.id;
  return { teamOwnerUserId };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<Params> },
) {
  const { id } = await params;
  const authOrRes = await requireTeamMember(req);
  if (authOrRes instanceof NextResponse) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);

  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.teamCustomExamples)
    .where(
      and(
        eq(schema.teamCustomExamples.id, id),
        eq(schema.teamCustomExamples.teamOwnerUserId, teamOwnerUserId),
      ),
    )
    .limit(1);

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json(envelope({ result: { example: row } }));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<Params> },
) {
  const { id } = await params;
  const authOrRes = await requireTeamMember(req);
  if (authOrRes instanceof NextResponse) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);

  const rl = await checkRateLimit(teamOwnerUserId);
  if (!rl.success) {
    return json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = UpdateExampleRequestSchema.safeParse(body);
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

  // Nothing to update → treat as a no-op with the current row.
  if (data.notes === undefined && data.contribute_upstream === undefined) {
    return json(
      { error: "Nothing to update. Send `notes` or `contribute_upstream`." },
      { status: 400 },
    );
  }

  const db = getDb();
  const updateSet: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (data.notes !== undefined) updateSet.notes = data.notes;
  if (data.contribute_upstream !== undefined) {
    updateSet.contributeUpstream = data.contribute_upstream;
  }

  const updated = await db
    .update(schema.teamCustomExamples)
    .set(updateSet)
    .where(
      and(
        eq(schema.teamCustomExamples.id, id),
        eq(schema.teamCustomExamples.teamOwnerUserId, teamOwnerUserId),
      ),
    )
    .returning();

  if (updated.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }

  revalidateDashboard();
  return json(envelope({ result: { example: updated[0] } }));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<Params> },
) {
  const { id } = await params;
  const authOrRes = await requireTeamMember(req);
  if (authOrRes instanceof NextResponse) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);

  const db = getDb();
  const deleted = await db
    .delete(schema.teamCustomExamples)
    .where(
      and(
        eq(schema.teamCustomExamples.id, id),
        eq(schema.teamCustomExamples.teamOwnerUserId, teamOwnerUserId),
      ),
    )
    .returning({ id: schema.teamCustomExamples.id });

  if (deleted.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }

  revalidateDashboard();
  return json(envelope({ result: { ok: true, deleted_id: id } }));
}
