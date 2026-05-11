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
import { enforceRateLimit } from "@/lib/ratelimit";
import { revalidateDashboard } from "@/lib/revalidate";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { InviteAcceptedEmail } from "@/emails/invite-accepted";

const RequestSchema = z.object({
  token: z.string().min(1),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Token-guess defense: rate-limit at the per-user bucket so an
  // attacker can't pelt /accept with random tokens at the same rate
  // they could query /api/check.
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

  const result = await acceptInvitation({
    token: parsed.data.token,
    acceptingUserId: user.id,
    acceptingUserEmail: user.email,
  });

  if (!result.ok) {
    const { status, message } = describeAcceptError(result.reason);
    return NextResponse.json({ error: message, code: result.reason }, { status });
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

  // Members page (and any other team-scoped surface) reflects the
  // newly-joined member; bust the cache.
  revalidateDashboard();
  return NextResponse.json({ ok: true });
}

// Translate the acceptInvitation() reason enum into a status code +
// a customer-facing message. The raw enum (`email_mismatch`, etc.)
// stays in the response as `code` for clients that want to branch
// on it programmatically; `error` is the human string we render.
function describeAcceptError(reason: string): {
  status: number;
  message: string;
} {
  switch (reason) {
    case "not_found":
      return {
        status: 404,
        message:
          "This invitation link doesn't match anything in our records. It may have been revoked, or the link may be incomplete.",
      };
    case "expired":
      return {
        status: 410,
        message: "This invitation expired. Ask the inviter to send a new one.",
      };
    case "email_mismatch":
      return {
        status: 403,
        message:
          "This invitation was sent to a different email address. Sign in with the right account to accept.",
      };
    case "no_seats":
      return {
        status: 402,
        message:
          "The team has no seats available. Ask the team owner to add seats first.",
      };
    case "already_accepted":
      return {
        status: 409,
        message: "This invitation has already been used.",
      };
    case "already_member":
      return {
        status: 409,
        message: "You're already a member of another team.",
      };
    case "is_team_owner":
      return {
        status: 409,
        message:
          "You already own a team. Cancel that subscription before joining another team.",
      };
    case "user_not_provisioned":
      return {
        status: 503,
        message:
          "We're still setting up your account. Refresh in a moment and try again.",
      };
    default:
      return {
        status: 409,
        message: "Couldn't accept the invitation. Try again. If it keeps happening, email hello@contentrx.io.",
      };
  }
}
