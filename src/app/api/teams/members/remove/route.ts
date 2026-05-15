/**
 * POST /api/teams/members/remove — remove a team member.
 *
 * Body: { memberUserId: string }
 *
 * Two legitimate callers (see resolveMemberRemoval for the policy):
 *   - the team OWNER removing one of their members, or
 *   - a MEMBER removing themselves (leave team).
 *
 * Either way the removed user is reset to a standalone Free account
 * and the seat is freed (countSeats drops memberCount, so the owner
 * can invite again). Owner-scoped at the DB layer — a memberUserId
 * from another team is a no-op (404, no existence leak), matching
 * the invitation-revoke route's contract.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/ratelimit";
import { revalidateDashboard } from "@/lib/revalidate";
import {
  removeMember,
  resolveMemberRemoval,
  resolveTeamId,
} from "@/lib/team-invitations";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { sanitizeZodIssues } from "@/lib/zod-errors";

const RequestSchema = z.object({
  memberUserId: z.string().min(1),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const rl = await enforceRateLimit(clerkId);
  if (rl) return rl;

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: sanitizeZodIssues(parsed.error.issues),
      },
      { status: 400 },
    );
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return NextResponse.json(
      { error: "User not provisioned yet" },
      { status: 404 },
    );
  }

  if (user.plan !== "team") {
    return NextResponse.json(
      { error: "Managing members requires a Team plan" },
      { status: 403 },
    );
  }

  const decision = resolveMemberRemoval({
    callerIsOwner: user.teamOwnerUserId === null,
    callerIsSelf: user.id === parsed.data.memberUserId,
  });
  if (!decision.allowed) {
    const message =
      decision.reason === "owner_cannot_leave"
        ? "The team owner can't leave their own team. Cancel the subscription in billing instead."
        : "Only the team owner can remove a teammate.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const teamOwnerUserId = resolveTeamId(user);
  const removed = await removeMember({
    teamOwnerUserId,
    memberUserId: parsed.data.memberUserId,
  });

  if (!removed) {
    // Not a member of this team (or another team's id). Same response
    // either way — don't leak existence.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Members page + seat counts read from team_members.
  revalidateDashboard();
  return NextResponse.json({ ok: true });
}
