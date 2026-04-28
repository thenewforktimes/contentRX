/**
 * POST   /api/dashboard/api-key — rotate (returns the raw key once)
 * DELETE /api/dashboard/api-key — revoke (nulls hash + prefix)
 *
 * Both require a Clerk session — this is a dashboard-only surface, not
 * an API-key-authenticated one, so CLI/plugin clients can't rotate their
 * own credentials by replaying a bearer token they already hold. The
 * user has to be signed in via the browser to touch their key.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import {
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
} from "@/lib/api-key";

export async function POST() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = getDb();
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: "User not provisioned yet" },
      { status: 404 },
    );
  }

  const rawKey = generateApiKey();
  const now = new Date();
  await db
    .update(schema.users)
    .set({
      apiKeyHash: hashApiKey(rawKey),
      apiKeyPrefix: apiKeyPrefix(rawKey),
      apiKeyCreatedAt: now,
    })
    .where(eq(schema.users.id, user.id));

  return NextResponse.json({
    key: rawKey,
    prefix: apiKeyPrefix(rawKey),
    created_at: now.toISOString(),
  });
}

export async function DELETE() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = getDb();
  await db
    .update(schema.users)
    .set({
      apiKeyHash: null,
      apiKeyPrefix: null,
      apiKeyCreatedAt: null,
    })
    .where(eq(schema.users.clerkId, clerkId));

  return NextResponse.json({ ok: true });
}
