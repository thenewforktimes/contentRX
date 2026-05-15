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
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { hashApiKey, isWellFormedApiKey } from "./api-key";
import { QUOTAS, type Plan } from "./quotas";

/**
 * Effective quota plan for a DOMAIN-GROUPED user.
 *
 * Domain grouping (domain-grouping.ts) flips same-domain Pro/Scale
 * subscribers to users.plan="team" so the dashboard can show a team
 * VIEW — explicitly "without a Team purchase decision." It is NOT a
 * billing change: each member keeps their own paid Pro/Scale
 * entitlement, un-pooled. (Robert, 2026-05-15.)
 *
 * So a grouped user's quota is their OWN subscription's pricing tier,
 * not the pooled Team bucket. An unentitled (canceled/past_due) sub
 * → free. `pricing_tier` is the 4-value tier; only pro/scale can
 * legitimately reach here (a real Team has an entitled plan='team'
 * row, handled before this is ever called).
 */
export function domainGroupedEffectivePlan(
  pricingTier: string | null | undefined,
  status: string | null | undefined,
): Plan {
  const entitled = status === "active" || status === "trialing";
  if (!entitled) return "free";
  if (pricingTier === "pro") return "pro";
  if (pricingTier === "scale") return "scale";
  return "free";
}

/** Validate a plan value loaded from the DB against the Plan enum.
 * Closes audit M-01: previously cast as Plan blindly; an invalid
 * value (DB hand-edit, future migration bug) would propagate to
 * monthlyQuota → undefined → NaN comparisons → quota always rejects.
 * Default to "free" so the user can still load the dashboard, log
 * the anomaly so we notice. */
function coercePlan(raw: unknown, userId: string): Plan {
  if (typeof raw === "string" && raw in QUOTAS) {
    return raw as Plan;
  }
  console.warn(
    `auth: user ${userId} has invalid plan ${JSON.stringify(raw)}, defaulting to "free"`,
  );
  return "free";
}

export type AuthResolved = {
  user: typeof schema.users.$inferSelect;
  plan: Plan;
  seats: number;
  teamOwnerUserId: string | null;
};

export type AuthError = {
  // 401 = bad credentials, 403 = forbidden, 503 = user row not
  // provisioned yet (Clerk webhook race on first signup — the
  // caller should retry shortly).
  status: 401 | 403 | 503;
  message: string;
};

export async function resolveAuth(req: Request): Promise<AuthResolved | AuthError> {
  const db = getDb();

  const apiKey = parseBearerToken(req.headers.get("authorization"));
  if (apiKey) {
    // Reject malformed bearer tokens up front — saves an unnecessary DB
    // round-trip and keeps malformed hashes out of the index lookup.
    if (!isWellFormedApiKey(apiKey)) {
      return { status: 401, message: "Invalid API key" };
    }
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.apiKeyHash, hashApiKey(apiKey)))
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
    // Webhook didn't fire or races with signup. 503 (not 401) so the
    // CLI / MCP / LSP can distinguish "your credentials are wrong"
    // from "your account is still being set up, try again in a
    // moment." 401 conflated the two and gave first-time users
    // immediately post-signup a misleading "Invalid API key" error.
    return {
      status: 503,
      message:
        "We're still setting up your account. Try again in a moment.",
    };
  }

  return await enrichWithSeats(user);
}

async function enrichWithSeats(
  user: typeof schema.users.$inferSelect,
): Promise<AuthResolved> {
  const plan = coercePlan(user.plan, user.id);

  if (plan !== "team") {
    return { user, plan, seats: 1, teamOwnerUserId: null };
  }

  // Team member: seats come from the team OWNER's entitled subscription.
  // Team owner's own row has team_owner_user_id = null; members have it set.
  // Status filter matches `isEntitled` (active OR trialing) — a trialing
  // team subscription still grants the paid seat count. Without the
  // trialing arm, owners in trial silently fell back to seats=1 and
  // their teammates hit the 1-seat quota despite the org having paid
  // for more. Canceled / past_due / unpaid subscriptions stop granting
  // seats immediately.
  const ownerId = user.teamOwnerUserId ?? user.id;

  const db = getDb();
  const [sub] = await db
    .select({ seats: schema.subscriptions.seats })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, ownerId),
        eq(schema.subscriptions.plan, "team"),
        inArray(schema.subscriptions.status, ["active", "trialing"]),
      ),
    )
    .limit(1);

  // Real Team (owner has an entitled plan='team' subscription):
  // unchanged pooled-seat behavior.
  if (sub) {
    return {
      user,
      plan,
      seats: sub.seats ?? 1,
      teamOwnerUserId: ownerId === user.id ? null : ownerId,
    };
  }

  // No real Team subscription, but users.plan="team". This is the
  // domain-grouping case: same-domain Pro/Scale subscribers flipped
  // to plan="team" for the team VIEW only. Per the view-only model
  // (Robert, 2026-05-15) each keeps their OWN paid entitlement,
  // un-pooled — NOT the pooled 2000/seat Team bucket (which, with
  // the failed seat lookup, collapsed an N-subscriber org to 2000
  // shared). Scoped strictly to rows carrying a domainGroupId so a
  // lapsed real-Team's resolution is left exactly as it was.
  const [ownSub] = await db
    .select({
      pricingTier: schema.subscriptions.pricingTier,
      status: schema.subscriptions.status,
    })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, user.id),
        isNotNull(schema.subscriptions.domainGroupId),
      ),
    )
    // Prefer an entitled row if the user has historical subs too.
    .orderBy(
      sql`case ${schema.subscriptions.status} when 'active' then 0 when 'trialing' then 1 else 2 end`,
      desc(schema.subscriptions.currentPeriodEnd),
    )
    .limit(1);

  if (ownSub) {
    return {
      user,
      plan: domainGroupedEffectivePlan(ownSub.pricingTier, ownSub.status),
      seats: 1,
      teamOwnerUserId: null, // un-pooled: own entitlement
    };
  }

  // Not domain-grouped and no Team subscription (e.g. a lapsed real
  // Team). Preserve the prior behavior exactly: in this branch `sub`
  // was always undefined, so the old `sub?.seats ?? 1` was always 1.
  return {
    user,
    plan,
    seats: 1,
    teamOwnerUserId: ownerId === user.id ? null : ownerId,
  };
}

// Exported for unit testing; not intended for use by other modules
// (resolveAuth is the public entry point).
export function parseBearerToken(header: string | null): string | null {
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
