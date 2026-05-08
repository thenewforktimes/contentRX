/**
 * POST /api/billing/overage-opt-in — toggle overage opt-in.
 *
 * Phase 4 of the post-Phase-1 build. Customers on paid plans (Pro,
 * Team, Scale) flip this switch to authorize $0.10/check overage past
 * their monthly cap. Free users are rejected (Free has no Stripe
 * subscription to bill against).
 *
 * Body: { active: boolean }
 *
 * On success returns { active, optedInAt }. The toggle is monotonic
 * via UPDATE — concurrent calls converge to the requested state.
 *
 * BETA_OVERAGE gate: while the env var is unset / not "true", the
 * route returns 404 (notFound posture — same as /admin/* in non-
 * founder requests, the URL itself is privileged information during
 * the beta window). Phase 5's flip is the only thing the route
 * needs to open up to all paid customers.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { sanitizeZodIssues } from "@/lib/zod-errors";

const RequestSchema = z.object({
  active: z.boolean(),
});

function isBetaOverageEnabled(): boolean {
  return process.env.BETA_OVERAGE === "true";
}

export async function POST(req: Request) {
  if (!isBetaOverageEnabled()) {
    // Same posture as /admin/* — don't confirm the route exists during
    // the beta window. Customers without BETA_OVERAGE access see a
    // 404 rather than a 403 + "you don't have access to overage."
    return NextResponse.json(
      {
        error:
          "Overage isn't available yet on your account. Email hello@contentrx.io if you have questions.",
      },
      { status: 404 },
    );
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json(
      { error: "Sign in to change overage settings." },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "We couldn't read your request. Try again, and email hello@contentrx.io if it keeps happening.",
        issues: sanitizeZodIssues(parsed.error.issues),
      },
      { status: 400 },
    );
  }
  const { active } = parsed.data;

  const db = getDb();
  const [user] = await db
    .select({
      id: schema.users.id,
      plan: schema.users.plan,
      overageOptInActive: schema.users.overageOptInActive,
      overageOptedInAt: schema.users.overageOptedInAt,
    })
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: "Your account isn't ready yet. Try again in a few minutes." },
      { status: 404 },
    );
  }

  if (user.plan === "free") {
    return NextResponse.json(
      {
        error:
          "Overage is available on paid plans only. Upgrade to Pro to enable it.",
      },
      { status: 403 },
    );
  }

  // First-time activation: stamp opted_in_at. Toggling off does NOT
  // clear it — the historical timestamp helps the founder dashboard
  // see when a customer first opted in (for support and analytics).
  // Re-activating after a deactivation overwrites it with the most
  // recent activation timestamp.
  const now = new Date();
  const nextOptedInAt =
    active && (!user.overageOptedInAt || !user.overageOptInActive)
      ? now
      : user.overageOptedInAt;

  const [updated] = await db
    .update(schema.users)
    .set({
      overageOptInActive: active,
      overageOptedInAt: nextOptedInAt,
    })
    .where(eq(schema.users.id, user.id))
    .returning({
      overageOptInActive: schema.users.overageOptInActive,
      overageOptedInAt: schema.users.overageOptedInAt,
    });

  return NextResponse.json({
    active: updated.overageOptInActive,
    optedInAt: updated.overageOptedInAt,
  });
}
