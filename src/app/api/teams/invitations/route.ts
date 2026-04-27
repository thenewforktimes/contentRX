/**
 * POST /api/teams/invitations — create a pending team invitation.
 *
 * Body: { email: string }
 *
 * Auth: Clerk session, plan must be "team". Per the Position-3
 * product direction (Apr 2026), any team member can invite — the
 * team owner is just the billing contact, not an admin role.
 *
 * On success, sends the team-invite email to the invitee with an
 * acceptance link (/join?token=...) and returns the invitation
 * envelope. The token itself is never echoed to the inviter UI.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appUrl, sendEmail } from "@/lib/email";
import { createInvitation, resolveTeamId } from "@/lib/team-invitations";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { TeamInviteEmail } from "@/emails/team-invite";

const RequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
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
      { error: "Inviting requires a Team plan" },
      { status: 403 },
    );
  }

  const teamOwnerUserId = resolveTeamId(user);

  // Look up the team owner's email (used by the email template + the
  // duplicate-of-owner check inside createInvitation).
  const ownerEmail = user.teamOwnerUserId === null ? user.email : null;
  const result = await createInvitation({
    teamOwnerUserId,
    email: parsed.data.email,
  });

  if (!result.ok) {
    const status =
      result.reason === "no_seats"
        ? 402
        : result.reason === "duplicate_pending_invite"
          ? 409
          : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // Send the invite email. Uses the existing TeamInviteEmail template
  // (`src/emails/team-invite.tsx`). Resolve teamOwnerEmail via either
  // the user record (if inviter == owner) or a follow-up DB read.
  let resolvedOwnerEmail = ownerEmail;
  if (resolvedOwnerEmail === null) {
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const [owner] = (await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, teamOwnerUserId))
      .limit(1)) as Array<{ email: string }>;
    resolvedOwnerEmail = owner?.email ?? "your team";
  }

  const acceptUrl = `${appUrl()}/join?token=${result.invitation.token}`;
  await sendEmail({
    to: result.invitation.email,
    subject: `${resolvedOwnerEmail} invited you to a ContentRX team`,
    react: TeamInviteEmail({
      appUrl: appUrl(),
      teamOwnerEmail: resolvedOwnerEmail,
      acceptUrl,
    }),
  });

  return NextResponse.json({
    invitation: {
      id: result.invitation.id,
      email: result.invitation.email,
      expiresAt: result.invitation.expiresAt.toISOString(),
      createdAt: result.invitation.createdAt.toISOString(),
    },
  });
}
