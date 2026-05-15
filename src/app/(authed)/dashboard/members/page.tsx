/**
 * /dashboard/members — the team's people surface.
 *
 * Plan-gated: Free/Pro → upsell card; Team → the panel (any team
 * member, not just the owner — Position-3 product direction).
 *
 * Renders the seat-usage line, an invite-by-email form, the pending
 * invitations list (with revoke), and the accepted members list.
 */

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import {
  countSeats,
  listMembers,
  listPendingInvitations,
  resolveTeamId,
} from "@/lib/team-invitations";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { MembersPanel } from "./members-panel";

export const metadata = {
  title: "Members. ContentRX",
};

export default async function MembersPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/members");
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-line p-6 text-sm">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  if (user.plan !== "team") {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-line p-6">
        <h1 className="text-lg font-semibold">Members</h1>
        <p className="text-sm text-default">
          Available on the Team plan. Invite teammates to share your
          monthly check limit and custom rules.
        </p>
        <Link href="/pricing" className={buttonStyles({ size: "sm" })}>
          Upgrade to Team
        </Link>
      </section>
    );
  }

  const teamOwnerUserId = resolveTeamId(user);
  // Owner's own users row has teamOwnerUserId === null (members point
  // at the owner). Only the owner can change billing, so only the
  // owner gets the "Add a seat" CTA; members see "ask your owner".
  const isOwner = user.teamOwnerUserId === null;
  const [members, pendingInvitations, seats] = await Promise.all([
    listMembers(teamOwnerUserId),
    listPendingInvitations(teamOwnerUserId),
    countSeats(teamOwnerUserId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
          Team
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Members</h1>
        <p className="mt-1 text-sm text-default">
          {seats.used} of {seats.capacity} seats used
          {seats.pendingInviteCount > 0 && (
            <>
              , including {seats.pendingInviteCount} pending{" "}
              {seats.pendingInviteCount === 1 ? "invite" : "invites"}
            </>
          )}
          .
        </p>
      </header>

      <MembersPanel
        members={members.map((m) => ({
          userId: m.userId,
          email: m.email,
          isOwner: m.isOwner,
          joinedAt: m.joinedAt.toISOString(),
        }))}
        pendingInvitations={pendingInvitations.map((p) => ({
          id: p.id,
          email: p.email,
          createdAt: p.createdAt.toISOString(),
          expiresAt: p.expiresAt.toISOString(),
        }))}
        seatsAvailable={seats.available}
        isOwner={isOwner}
        currentUserId={user.id}
      />
    </div>
  );
}
