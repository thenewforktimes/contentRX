/**
 * POST   /api/preferences/opt-out — mark the current user as opted out.
 * DELETE /api/preferences/opt-out — clear the opt-out (opt back in).
 *
 * Human-eval build plan Session 31. Opt-out is honored immediately by
 * `/api/preferences/session`. The row's opt-out timestamp is preserved
 * until an explicit DELETE; that way we can distinguish "never
 * prompted" from "explicitly declined" in telemetry.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { envelope } from "@/lib/api-envelope";
import { OptOutRequestSchema } from "@/lib/preferences-schemas";
import { enforceRateLimit } from "@/lib/ratelimit";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";

async function currentUserId(): Promise<string | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const db = getDb();
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);
  return user?.id ?? null;
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const rl = await enforceRateLimit(userId);
  if (rl) return rl;

  const body = await req.json().catch(() => ({}));
  const parsed = OptOutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: sanitizeZodIssues(parsed.error.issues),
      },
      { status: 400 },
    );
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.users)
    .set({ preferenceOptedOutAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning({ optedOutAt: schema.users.preferenceOptedOutAt });

  return NextResponse.json(
    envelope({
      result: {
        opted_out_at: updated?.optedOutAt?.toISOString() ?? null,
      },
    }),
  );
}

export async function DELETE() {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const rl = await enforceRateLimit(userId);
  if (rl) return rl;

  const db = getDb();
  await db
    .update(schema.users)
    .set({ preferenceOptedOutAt: null })
    .where(eq(schema.users.id, userId));

  return NextResponse.json(envelope({ result: { opted_out_at: null } }));
}
