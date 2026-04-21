/**
 * Resolve a request to (user_row, plan, seats).
 *
 * Two ways to authenticate:
 *   1. Clerk session cookie — web and Figma plugin after sign-in
 *   2. Authorization: Bearer <api_key> — CLI, GitHub Action, server-to-server
 *
 * Both paths end at the same users row. For team-plan users the caller's
 * effective quota is scaled by the team owner's subscription seats, so we
 * return the team owner's seat count alongside the plan.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Plan } from "./quotas";

export type AuthResolved = {
  user: typeof schema.users.$inferSelect;
  plan: Plan;
  seats: number;
  teamOwnerUserId: string | null;
};

export type AuthError = {
  status: 401 | 403;
  message: string;
};

export async function resolveAuth(req: Request): Promise<AuthResolved | AuthError> {
  const db = getDb();

  const apiKey = parseBearerToken(req.headers.get("authorization"));
  if (apiKey) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.apiKey, apiKey))
      .limit(1);
    if (!user) {
      return { status: 401, message: "Invalid API key" };
    }
    return await enrichWithSeats(user);
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return { status: 401, message: "Authentication required" };
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    // Webhook didn't fire or races with signup. Fail closed; the client
    // should retry after signup completes.
    return { status: 401, message: "User not provisioned yet" };
  }

  return await enrichWithSeats(user);
}

async function enrichWithSeats(
  user: typeof schema.users.$inferSelect,
): Promise<AuthResolved> {
  const plan = user.plan as Plan;

  if (plan !== "team") {
    return { user, plan, seats: 1, teamOwnerUserId: null };
  }

  // Team member: seats come from the team OWNER's active subscription.
  // Team owner's own row has team_owner_user_id = null; members have it set.
  const ownerId = user.teamOwnerUserId ?? user.id;

  const db = getDb();
  const [sub] = await db
    .select({ seats: schema.subscriptions.seats })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, ownerId),
        eq(schema.subscriptions.plan, "team"),
      ),
    )
    .limit(1);

  return {
    user,
    plan,
    seats: sub?.seats ?? 1,
    teamOwnerUserId: ownerId === user.id ? null : ownerId,
  };
}

function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  // Heuristic: Clerk session JWTs are very long; our API keys are shorter
  // and prefixed "cx_" (see src/app/api/dashboard/api-key/route.ts). Only
  // treat tokens we know to be API keys as such.
  if (!token.startsWith("cx_")) return null;
  return token;
}
