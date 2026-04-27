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
import { UpdateExampleRequestSchema } from "@/lib/custom-examples-schemas";
import { checkRateLimit } from "@/lib/ratelimit";
import { revalidateDashboard } from "@/lib/revalidate";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

type Params = { id: string };

async function requireTeamMember(
  req: Request,
): Promise<{ teamOwnerUserId: string } | NextResponse> {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return withCors(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
    );
  }
  if (auth.plan !== "team") {
    return withCors(
      NextResponse.json(
        { error: "Custom examples are a Team-plan feature." },
        { status: 403 },
      ),
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

  if (!row) {
    return withCors(
      NextResponse.json({ error: "Not found" }, { status: 404 }),
    );
  }

  return withCors(
    NextResponse.json(envelope({ result: { example: row } })),
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<Params> },
) {
  const { id } = await params;
  const authOrRes = await requireTeamMember(req);
  if (authOrRes instanceof NextResponse) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

  const rl = await checkRateLimit(teamOwnerUserId);
  if (!rl.success) {
    return withCors(
      NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      ),
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = UpdateExampleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return withCors(
      NextResponse.json(
        {
          error: "Invalid request",
          issues: sanitizeZodIssues(parsed.error.issues),
        },
        { status: 400 },
      ),
    );
  }
  const data = parsed.data;

  // Nothing to update → treat as a no-op with the current row.
  if (data.notes === undefined && data.contribute_upstream === undefined) {
    return withCors(
      NextResponse.json(
        { error: "Nothing to update. Send `notes` or `contribute_upstream`." },
        { status: 400 },
      ),
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
    return withCors(
      NextResponse.json({ error: "Not found" }, { status: 404 }),
    );
  }

  revalidateDashboard();
  return withCors(
    NextResponse.json(envelope({ result: { example: updated[0] } })),
  );
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<Params> },
) {
  const { id } = await params;
  const authOrRes = await requireTeamMember(req);
  if (authOrRes instanceof NextResponse) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

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
    return withCors(
      NextResponse.json({ error: "Not found" }, { status: 404 }),
    );
  }

  revalidateDashboard();
  return withCors(
    NextResponse.json(envelope({ result: { ok: true, deleted_id: id } })),
  );
}
