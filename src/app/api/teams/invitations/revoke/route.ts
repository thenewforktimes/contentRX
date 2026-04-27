/**
 * POST /api/teams/invitations/revoke — delete a pending invitation.
 *
 * Body: { id: string }
 *
 * Auth: Clerk session, plan must be "team". Per Position-3, any team
 * member can revoke (they share invite/revoke power; the owner role
 * is billing-only). Revocation is owner-scoped at the DB layer —
 * passing an `id` for another team's invitation is a no-op.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateDashboard } from "@/lib/revalidate";
import { resolveTeamId, revokeInvitation } from "@/lib/team-invitations";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { sanitizeZodIssues } from "@/lib/zod-errors";

const RequestSchema = z.object({
  id: z.string().min(1),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      { error: "Revoking requires a Team plan" },
      { status: 403 },
    );
  }

  const teamOwnerUserId = resolveTeamId(user);
  const ok = await revokeInvitation({ id: parsed.data.id, teamOwnerUserId });

  if (!ok) {
    // Either the id didn't match a pending invitation, or it belonged
    // to a different team. Same response either way — don't leak
    // existence.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Members page reads from team_invitations.
  revalidateDashboard();
  return NextResponse.json({ ok: true });
}
