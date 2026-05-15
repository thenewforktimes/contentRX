"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { safeStripeRedirect } from "@/lib/stripe-redirect";

type Member = {
  userId: string;
  email: string;
  isOwner: boolean;
  joinedAt: string;
};

type Invitation = {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
};

type InviteState = "idle" | "submitting" | "error" | "success";

export function MembersPanel({
  members,
  pendingInvitations,
  seatsAvailable,
  isOwner,
  currentUserId,
}: {
  members: Member[];
  pendingInvitations: Invitation[];
  seatsAvailable: number;
  isOwner: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<InviteState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [addingSeat, setAddingSeat] = useState(false);
  // Two-step confirm: first click arms (id here), second click commits.
  const [confirmingRemovalId, setConfirmingRemovalId] = useState<
    string | null
  >(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const seatsFull = seatsAvailable === 0;

  async function onRemove(memberUserId: string) {
    setRemovingId(memberUserId);
    setError(null);
    try {
      const res = await fetch("/api/teams/members/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberUserId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Remove failed (${res.status}).`);
      }
      setConfirmingRemovalId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setRemovingId(null);
    }
  }

  async function onAddSeat() {
    setAddingSeat(true);
    setError(null);
    try {
      const res = await fetch("/api/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flow: "manage_seats" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ??
            "Couldn't open billing to add a seat. Try again, or email hello@contentrx.io.",
        );
      }
      const { url } = (await res.json()) as { url?: unknown };
      window.location.href = safeStripeRedirect(url);
    } catch (err) {
      setAddingSeat(false);
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't open billing to add a seat.",
      );
    }
  }

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("submitting");
    setError(null);
    try {
      const res = await fetch("/api/teams/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(humanizeInviteError(body.error ?? `${res.status}`));
      }
      setEmail("");
      setState("success");
      router.refresh();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Invite failed.");
    }
  }

  async function onRevoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch("/api/teams/invitations/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        throw new Error(`Revoke failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-line p-5">
        <h2 className="text-base font-semibold text-strong">Invite a teammate</h2>
        <p className="mt-1 text-xs text-default">
          They&apos;ll get an email with a link that&apos;s good for 7 days.
        </p>
        {/* "No seats" guidance now lives on the Input via helperText —
            keeps cause-and-effect adjacent to the locked field instead
            of three lines up in body prose. */}
        <form onSubmit={onInvite} className="mt-3 flex flex-wrap gap-2">
          {/*
           * Accessible-name pattern: visually-hidden <label> paired
           * with the Input via htmlFor + id. The placeholder is not a
           * substitute for a label (WCAG 3.3.2).
           *
           * 2026-05-14 — `error` prop now passed to <Input>, which
           * wires aria-invalid + aria-describedby + role="alert" +
           * the concern border, and renders the message in line.
           * Replaces the previous separate alert block which left the
           * field visually unmarked even though invalid. `helperText`
           * surfaces the "No seats available" cause-and-effect right
           * next to the locked field, not three lines up in body copy.
           */}
          <label htmlFor="invite-email" className="sr-only">
            Teammate email
          </label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            required
            aria-required="true"
            disabled={state === "submitting" || seatsFull}
            error={error ?? undefined}
            helperText={
              seatsFull
                ? isOwner
                  ? "Every seat is taken. Add a seat to invite a teammate."
                  : "Every seat is taken. Ask the team owner to add a seat."
                : undefined
            }
            className="flex-1 min-w-[240px]"
          />
          <Button
            type="submit"
            disabled={state === "submitting" || seatsAvailable === 0 || !email.trim()}
            size="sm"
            aria-busy={state === "submitting" || undefined}
          >
            {state === "submitting" ? "Sending…" : "Send invite"}
          </Button>
        </form>
        {state === "success" && (
          <p className="mt-3 text-xs text-accent-affirm-text">
            Invite sent.
          </p>
        )}
        {seatsFull && isOwner && (
          // Real path out of the seat-full dead-end: deep-links into
          // the Stripe Portal's seat-quantity screen. Owner-only —
          // members can't change billing (the helperText tells them
          // to ask the owner).
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-overlay p-3">
            <p className="flex-1 text-xs text-default">
              You&apos;re using every seat on your plan. Add a seat to
              open room for a teammate. Billing updates immediately in
              Stripe.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onAddSeat}
              disabled={addingSeat}
              aria-busy={addingSeat || undefined}
            >
              {addingSeat ? "Opening billing…" : "Add a seat"}
            </Button>
          </div>
        )}
      </section>

      {pendingInvitations.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-strong">Pending invitations</h2>
          <ul className="flex flex-col gap-2">
            {pendingInvitations.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-md border border-line p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{p.email}</p>
                  <p className="text-xs text-quiet">
                    Sent {formatDate(p.createdAt)} · expires{" "}
                    {formatDate(p.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(p.id)}
                  disabled={revokingId === p.id}
                  // Per-row aria-label so SR users can distinguish the
                  // (otherwise identical) Revoke buttons (WCAG 2.4.4).
                  aria-label={`Revoke invitation for ${p.email}`}
                  aria-busy={revokingId === p.id || undefined}
                  className="shrink-0 rounded-md border border-line-strong px-2 py-1 text-xs hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised disabled:opacity-50"
                >
                  {revokingId === p.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-strong">Members</h2>
        {members.length === 1 && members[0]?.isOwner ? (
          // Solo team — owner only, no invites accepted yet. The form
          // above (Invite a teammate) IS the empty-state CTA, so this
          // copy stays brief and points at it without restating the
          // action. Pre-beta audit caught this case rendering as just
          // the owner row with no context.
          <p className="rounded-md border border-dashed border-line-strong bg-overlay p-4 text-sm text-default">
            You&apos;re flying solo. Invite a teammate above and
            they&apos;ll appear here once they accept.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-4 rounded-md border border-line p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {m.email}
                    {m.isOwner && (
                      <Pill tone="emerald" className="ml-2">
                        Owner
                      </Pill>
                    )}
                  </p>
                  {!m.isOwner && (
                    <p className="text-xs text-quiet">
                      Joined {formatDate(m.joinedAt)}
                    </p>
                  )}
                </div>
                {(() => {
                  // Owner row has no remove/leave affordance (the owner
                  // can't leave via this path; nobody "removes" the
                  // owner). For non-owner rows: the owner sees "Remove",
                  // the member sees "Leave team" on their own row, and a
                  // member viewing another member sees nothing (only the
                  // owner can remove others — the route enforces this too).
                  if (m.isOwner) return null;
                  const isSelf = m.userId === currentUserId;
                  if (!isOwner && !isSelf) return null;
                  const label = isSelf ? "Leave team" : "Remove";
                  const busyLabel = isSelf ? "Leaving…" : "Removing…";
                  const arming = confirmingRemovalId === m.userId;
                  const busy = removingId === m.userId;
                  if (arming) {
                    return (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-quiet">
                          {isSelf ? "Leave this team?" : "Remove?"}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemove(m.userId)}
                          disabled={busy}
                          aria-busy={busy || undefined}
                          aria-label={`Confirm ${label.toLowerCase()}${
                            isSelf ? "" : ` ${m.email}`
                          }`}
                          className="rounded-md border border-accent-concern-border bg-accent-concern-soft px-2 py-1 text-xs font-medium text-accent-concern-text hover:bg-accent-concern-soft-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised disabled:opacity-50"
                        >
                          {busy ? busyLabel : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingRemovalId(null)}
                          disabled={busy}
                          className="rounded-md border border-line-strong px-2 py-1 text-xs hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setConfirmingRemovalId(m.userId);
                      }}
                      aria-label={
                        isSelf ? "Leave team" : `Remove ${m.email}`
                      }
                      className="shrink-0 rounded-md border border-line-strong px-2 py-1 text-xs hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised"
                    >
                      {label}
                    </button>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function humanizeInviteError(reason: string): string {
  switch (reason) {
    case "no_seats":
      return "Every seat is taken. Add a seat below to invite a teammate.";
    case "duplicate_pending_invite":
      return "An invite is already pending for that email.";
    case "already_member":
      return "That email is already a member of your team.";
    case "is_team_owner":
      return "That's your own email. You can't invite yourself.";
    default:
      return `Invite failed (${reason}).`;
  }
}
