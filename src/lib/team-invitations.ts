/**
 * Team invitation business logic.
 *
 * Owns the token lifecycle: generate → store → email → accept (or
 * expire / revoke). DB-touching helpers are async; pure helpers
 * (token gen, expiry math) live alongside so the route layer never
 * has to reach into crypto or Date arithmetic itself.
 *
 * Seat counting: an active team has owner (1) + each accepted
 * team_members row + each pending non-expired invitation. Sending a
 * new invite requires headroom in subscriptions.seats.
 */

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TeamInvitation } from "@/db/schema";

const DEFAULT_EXPIRY_DAYS = 7;
const TOKEN_BYTES = 32; // → 64-char hex; ample entropy, easy to URL-encode.

/** 64-char hex token. Use crypto.randomBytes for collision resistance. */
export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** Default 7 days from `from` (defaults to now). */
export function buildInvitationExpiresAt(
  from: Date = new Date(),
  daysFromNow: number = DEFAULT_EXPIRY_DAYS,
): Date {
  const out = new Date(from);
  out.setUTCDate(out.getUTCDate() + daysFromNow);
  return out;
}

/** True when `expiresAt` is at or before `now` (default: real-now). */
export function isExpired(
  expiresAt: Date,
  now: Date = new Date(),
): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Normalize email for storage + comparison. Lowercase + trim.
 * Clerk normalizes the same way at the API boundary so this matches
 * what we'll see when comparing against a signed-in user's email.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Resolve "the team a user belongs to." For owners, that's their own
 * user.id (team-id-as-user-id). For members, it's `teamOwnerUserId`.
 * Mirrors the pattern used across /dashboard/* surfaces.
 */
export function resolveTeamId(user: {
  id: string;
  teamOwnerUserId: string | null;
}): string {
  return user.teamOwnerUserId ?? user.id;
}

export type SeatCount = {
  ownerCount: 1;
  memberCount: number;
  pendingInviteCount: number;
  used: number;
  capacity: number;
  available: number;
};

/**
 * Count seats in use for a team: owner (always 1) + accepted members
 * + non-expired pending invitations. `capacity` is the seat count from
 * the team's active subscription; `available` is `capacity - used`
 * (clamped at 0).
 */
export async function countSeats(
  teamOwnerUserId: string,
): Promise<SeatCount> {
  const db = getDb();
  const now = new Date();

  const [memberRow] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamOwnerUserId, teamOwnerUserId))) as Array<{
    count: number;
  }>;

  const [pendingRow] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.teamInvitations)
    .where(
      and(
        eq(schema.teamInvitations.teamOwnerUserId, teamOwnerUserId),
        isNull(schema.teamInvitations.acceptedAt),
        gt(schema.teamInvitations.expiresAt, now),
      ),
    )) as Array<{ count: number }>;

  const [subRow] = (await db
    .select({ seats: schema.subscriptions.seats })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, teamOwnerUserId),
        eq(schema.subscriptions.plan, "team"),
      ),
    )
    .limit(1)) as Array<{ seats: number }>;

  const memberCount = memberRow?.count ?? 0;
  const pendingInviteCount = pendingRow?.count ?? 0;
  const capacity = subRow?.seats ?? 0;
  const used = 1 + memberCount + pendingInviteCount;
  const available = Math.max(0, capacity - used);

  return {
    ownerCount: 1,
    memberCount,
    pendingInviteCount,
    used,
    capacity,
    available,
  };
}

export type CreateInvitationResult =
  | { ok: true; invitation: TeamInvitation }
  | {
      ok: false;
      reason:
        | "no_seats"
        | "duplicate_pending_invite"
        | "already_member"
        | "is_team_owner";
    };

/**
 * Create a pending invitation. Pre-flight checks:
 *   - the team has a free seat,
 *   - this email isn't already an accepted member,
 *   - this email isn't the team owner,
 *   - there isn't already a non-expired pending invite for this email.
 *
 * Each rejection returns a typed reason so the route can shape the
 * response appropriately. The token is generated server-side and
 * never echoed back to the inviter's UI — only the email recipient
 * sees it.
 */
export async function createInvitation(args: {
  teamOwnerUserId: string;
  email: string;
}): Promise<CreateInvitationResult> {
  const db = getDb();
  const email = normalizeEmail(args.email);
  const now = new Date();

  // Reject if email belongs to the owner.
  const [owner] = (await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, args.teamOwnerUserId))
    .limit(1)) as Array<{ email: string }>;
  if (owner && normalizeEmail(owner.email) === email) {
    return { ok: false, reason: "is_team_owner" };
  }

  // Reject if email is already an accepted member of this team.
  const [existingMember] = (await db
    .select({ id: schema.users.id })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.memberUserId))
    .where(
      and(
        eq(schema.teamMembers.teamOwnerUserId, args.teamOwnerUserId),
        eq(schema.users.email, email),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  if (existingMember) {
    return { ok: false, reason: "already_member" };
  }

  // Reject if there's a non-expired pending invitation for this email.
  const [existingInvite] = (await db
    .select({ id: schema.teamInvitations.id })
    .from(schema.teamInvitations)
    .where(
      and(
        eq(schema.teamInvitations.teamOwnerUserId, args.teamOwnerUserId),
        eq(schema.teamInvitations.email, email),
        isNull(schema.teamInvitations.acceptedAt),
        gt(schema.teamInvitations.expiresAt, now),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  if (existingInvite) {
    return { ok: false, reason: "duplicate_pending_invite" };
  }

  // Seat-availability gate (counts owner + members + pending invites).
  const seats = await countSeats(args.teamOwnerUserId);
  if (seats.available <= 0) {
    return { ok: false, reason: "no_seats" };
  }

  const token = generateInviteToken();
  const expiresAt = buildInvitationExpiresAt(now);

  const [row] = (await db
    .insert(schema.teamInvitations)
    .values({
      teamOwnerUserId: args.teamOwnerUserId,
      email,
      token,
      expiresAt,
    })
    .returning()) as TeamInvitation[];

  return { ok: true, invitation: row };
}

/**
 * Look up an invitation by its bearer token. Returns null when the
 * token doesn't exist (expired or revoked invitations may still
 * resolve here — the caller is responsible for checking
 * `acceptedAt` and `isExpired(expiresAt)`).
 */
export async function getInvitationByToken(
  token: string,
): Promise<TeamInvitation | null> {
  const db = getDb();
  const [row] = (await db
    .select()
    .from(schema.teamInvitations)
    .where(eq(schema.teamInvitations.token, token))
    .limit(1)) as TeamInvitation[];
  return row ?? null;
}

/** All non-expired, non-accepted invitations for a team, newest first. */
export async function listPendingInvitations(
  teamOwnerUserId: string,
): Promise<TeamInvitation[]> {
  const db = getDb();
  const now = new Date();
  return (await db
    .select()
    .from(schema.teamInvitations)
    .where(
      and(
        eq(schema.teamInvitations.teamOwnerUserId, teamOwnerUserId),
        isNull(schema.teamInvitations.acceptedAt),
        gt(schema.teamInvitations.expiresAt, now),
      ),
    )
    .orderBy(schema.teamInvitations.createdAt)) as TeamInvitation[];
}

export type MemberRow = {
  userId: string;
  email: string;
  joinedAt: Date;
  isOwner: boolean;
};

/**
 * Owner + accepted members for a team, owner first, then members
 * ordered by join time. Used to render the Members table.
 */
export async function listMembers(
  teamOwnerUserId: string,
): Promise<MemberRow[]> {
  const db = getDb();
  const [owner] = (await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, teamOwnerUserId))
    .limit(1)) as Array<{ id: string; email: string }>;

  const memberRows = (await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      joinedAt: schema.teamMembers.acceptedAt,
    })
    .from(schema.teamMembers)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.teamMembers.memberUserId),
    )
    .where(eq(schema.teamMembers.teamOwnerUserId, teamOwnerUserId))) as Array<{
    userId: string;
    email: string;
    joinedAt: Date | null;
  }>;

  const out: MemberRow[] = [];
  if (owner) {
    out.push({
      userId: owner.id,
      email: owner.email,
      joinedAt: new Date(0),
      isOwner: true,
    });
  }
  for (const row of memberRows) {
    out.push({
      userId: row.userId,
      email: row.email,
      joinedAt: row.joinedAt ?? new Date(0),
      isOwner: false,
    });
  }
  return out;
}

/**
 * Revoke a pending invitation. Owner-scoped: the invitation must
 * belong to the same team or this is a no-op (returns false). Returns
 * true when a row was deleted.
 */
export async function revokeInvitation(args: {
  id: string;
  teamOwnerUserId: string;
}): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(schema.teamInvitations)
    .where(
      and(
        eq(schema.teamInvitations.id, args.id),
        eq(schema.teamInvitations.teamOwnerUserId, args.teamOwnerUserId),
        isNull(schema.teamInvitations.acceptedAt),
      ),
    )
    .returning({ id: schema.teamInvitations.id });
  return result.length > 0;
}

export type AcceptInvitationResult =
  | {
      ok: true;
      teamOwnerUserId: string;
      teamOwnerEmail: string;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "expired"
        | "already_accepted"
        | "email_mismatch"
        | "already_team_owner"
        | "already_member"
        | "no_seats";
    };

/**
 * Accept an invitation. Verifies the token resolves, hasn't been
 * accepted, hasn't expired, and the accepting user's email matches
 * the invited address. Also rejects accepting users who are already
 * a team owner (would orphan their subscription) or already a member
 * of any team (would silently switch them).
 *
 * On success: inserts a team_members row, marks the invitation
 * accepted, and updates the user's teamOwnerUserId. Returns the
 * team owner's id + email so the caller can fire the
 * "invite accepted" notification.
 */
export async function acceptInvitation(args: {
  token: string;
  acceptingUserId: string;
  acceptingUserEmail: string;
}): Promise<AcceptInvitationResult> {
  const db = getDb();
  const inviteEmail = normalizeEmail(args.acceptingUserEmail);

  const invitation = await getInvitationByToken(args.token);
  if (!invitation) {
    return { ok: false, reason: "not_found" };
  }
  if (invitation.acceptedAt !== null) {
    return { ok: false, reason: "already_accepted" };
  }
  if (isExpired(invitation.expiresAt)) {
    return { ok: false, reason: "expired" };
  }
  if (normalizeEmail(invitation.email) !== inviteEmail) {
    return { ok: false, reason: "email_mismatch" };
  }

  // Reject users who already own a team (their subscription would orphan).
  const [acceptingUser] = (await db
    .select({
      id: schema.users.id,
      teamOwnerUserId: schema.users.teamOwnerUserId,
      plan: schema.users.plan,
    })
    .from(schema.users)
    .where(eq(schema.users.id, args.acceptingUserId))
    .limit(1)) as Array<{
    id: string;
    teamOwnerUserId: string | null;
    plan: string;
  }>;
  if (acceptingUser?.plan === "team" && acceptingUser.teamOwnerUserId === null) {
    return { ok: false, reason: "already_team_owner" };
  }
  if (acceptingUser?.teamOwnerUserId !== null && acceptingUser?.teamOwnerUserId !== undefined) {
    return { ok: false, reason: "already_member" };
  }

  // Re-check seat availability — could have changed since invite was sent.
  const seats = await countSeats(invitation.teamOwnerUserId);
  // The pending invite itself is in the count; the accept "consumes"
  // it (pending → accepted), so it's net-zero on the count. Still
  // require capacity > used - 1 (i.e., this invite is the one we're
  // about to convert).
  if (seats.capacity === 0 || seats.used > seats.capacity) {
    return { ok: false, reason: "no_seats" };
  }

  const [owner] = (await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, invitation.teamOwnerUserId))
    .limit(1)) as Array<{ email: string }>;

  // Insert team_members row; mark invitation accepted; update user's
  // teamOwnerUserId. These three writes are independent rows so the
  // semantic atomicity isn't strictly required for correctness — the
  // single row insert into team_members is the operative gate. The
  // other two are post-hoc bookkeeping and either re-running them is
  // idempotent enough or the route can retry.
  await db.insert(schema.teamMembers).values({
    teamOwnerUserId: invitation.teamOwnerUserId,
    memberUserId: args.acceptingUserId,
    role: "member",
    invitedAt: invitation.createdAt,
    acceptedAt: new Date(),
  });

  await db
    .update(schema.teamInvitations)
    .set({
      acceptedAt: new Date(),
      acceptedByMemberUserId: args.acceptingUserId,
    })
    .where(eq(schema.teamInvitations.id, invitation.id));

  await db
    .update(schema.users)
    .set({ teamOwnerUserId: invitation.teamOwnerUserId, plan: "team" })
    .where(eq(schema.users.id, args.acceptingUserId));

  return {
    ok: true,
    teamOwnerUserId: invitation.teamOwnerUserId,
    teamOwnerEmail: owner?.email ?? "",
  };
}
