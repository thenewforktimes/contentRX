/**
 * POST /api/teams/invitations/accept — accept a pending invitation.
 *
 * Body: { token: string }
 *
 * Auth: Clerk session required (the accepting user must already be
 * signed up — the /join page handles redirecting unauthenticated
 * users through Clerk first).
 *
 * The accept itself runs in `acceptInvitation`, which validates the
 * token, checks email match, and atomically creates the team_members
 * row + marks the invitation accepted + flips the user's
 * teamOwnerUserId. On success, fires the invite-accepted notification
 * email to the team owner.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvitation } from "@/lib/team-invitations";
import { appUrl, sendEmail } from "@/lib/email";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { InviteAcceptedEmail } from "@/emails/invite-accepted";

const RequestSchema = z.object({
  token: z.string().min(1),
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

  const result = await acceptInvitation({
    token: parsed.data.token,
    acceptingUserId: user.id,
    acceptingUserEmail: user.email,
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "expired"
          ? 410
          : result.reason === "email_mismatch"
            ? 403
            : result.reason === "no_seats"
              ? 402
              : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // Notify the team owner (best effort — don't block the accept on
  // email send failures).
  if (result.teamOwnerEmail) {
    await sendEmail({
      to: result.teamOwnerEmail,
      subject: `${user.email} joined your ContentRX team`,
      react: InviteAcceptedEmail({
        appUrl: appUrl(),
        inviteeEmail: user.email,
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
