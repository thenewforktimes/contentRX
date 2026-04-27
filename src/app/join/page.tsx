/**
 * /join?token=... — invitation acceptance landing.
 *
 * Server-renders the confirm UI when the token resolves cleanly,
 * otherwise an inline error explaining what went wrong (token not
 * found, expired, already accepted, email mismatch, etc.).
 *
 * Auth flow: if the visitor isn't signed in, redirect through Clerk
 * sign-in with this URL preserved in `redirect_url` so they land back
 * here after authentication.
 */

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getInvitationByToken,
  isExpired,
  normalizeEmail,
} from "@/lib/team-invitations";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { JoinButton } from "./join-button";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export const metadata = {
  title: "Join a team — ContentRX",
};

export default async function JoinPage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) {
    return <ErrorCard title="Missing token" body="This invitation link is incomplete. Ask the person who invited you to resend it." />;
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect(`/sign-in?redirect_url=/join?token=${encodeURIComponent(token)}`);
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <ErrorCard
        title="Setting up your account…"
        body="We're finishing setup. Refresh in a moment to continue."
      />
    );
  }

  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    return (
      <ErrorCard
        title="Invitation not found"
        body="This invitation link doesn't match anything in our records. It may have been revoked, or the link may be incomplete. Ask the inviter to resend."
      />
    );
  }

  if (invitation.acceptedAt !== null) {
    return (
      <ErrorCard
        title="Already accepted"
        body="This invitation has already been used. If you've joined the team, head to your dashboard."
        cta={{ href: "/dashboard", label: "Open dashboard" }}
      />
    );
  }

  if (isExpired(invitation.expiresAt)) {
    return (
      <ErrorCard
        title="Invitation expired"
        body="This invitation expired. Ask the inviter to send a new one."
      />
    );
  }

  if (normalizeEmail(invitation.email) !== normalizeEmail(user.email)) {
    return (
      <ErrorCard
        title="Wrong account"
        body={`This invitation was sent to ${invitation.email}. You're signed in as ${user.email}. Sign out and sign in with the right account to accept.`}
      />
    );
  }

  if (user.plan === "team" && user.teamOwnerUserId === null) {
    return (
      <ErrorCard
        title="You already own a team"
        body="You're the owner of an existing ContentRX team plan. Joining another team would orphan your subscription. Cancel your team plan first if you want to join this one."
        cta={{ href: "/dashboard", label: "Open dashboard" }}
      />
    );
  }

  if (user.teamOwnerUserId !== null) {
    return (
      <ErrorCard
        title="Already on a team"
        body="You're already a member of a ContentRX team. Leave your current team before accepting this invitation."
        cta={{ href: "/dashboard", label: "Open dashboard" }}
      />
    );
  }

  // Resolve the inviting team owner's email for the confirmation UI.
  const db = getDb();
  const [owner] = (await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, invitation.teamOwnerUserId))
    .limit(1)) as Array<{ email: string }>;

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <header className="mb-6">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          You&apos;re invited
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          Join {owner?.email ?? "a ContentRX team"}
        </h1>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          Accepting this invitation adds your account to the team. You&apos;ll
          share the team&apos;s monthly scan quota, custom rules, and
          custom examples.
        </p>
      </header>

      <JoinButton token={token} />

      <p className="mt-6 text-xs text-neutral-500">
        Signed in as <span className="font-mono">{user.email}</span>. If
        that&apos;s not right,{" "}
        <Link href="/sign-out" className="underline underline-offset-2">
          sign out
        </Link>
        {" "}first.
      </p>
    </main>
  );
}

function ErrorCard({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <section className="rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          {body}
        </p>
        {cta && (
          <Link
            href={cta.href}
            className="mt-4 inline-block rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {cta.label}
          </Link>
        )}
      </section>
    </main>
  );
}
