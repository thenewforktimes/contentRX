"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";

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
}: {
  members: Member[];
  pendingInvitations: Invitation[];
  seatsAvailable: number;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<InviteState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

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
          {seatsAvailable === 0 && (
            <>
              {" "}
              No seats available. Add seats from billing first.
            </>
          )}
        </p>
        <form onSubmit={onInvite} className="mt-3 flex flex-wrap gap-2">
          {/*
           * Accessible-name pattern: visually-hidden <label> paired
           * with the Input via htmlFor + id. The placeholder is not a
           * substitute for a label (WCAG 3.3.2). aria-invalid + the
           * error block linked via aria-describedby are wired by the
           * Input primitive itself (see input.tsx — PR 3) once `error`
           * prop is passed.
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
            disabled={state === "submitting" || seatsAvailable === 0}
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
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-accent-concern-border bg-accent-concern-soft px-3 py-2 text-xs text-accent-concern-text"
          >
            {error}
          </p>
        )}
        {state === "success" && (
          <p className="mt-3 text-xs text-accent-affirm-text">
            Invite sent.
          </p>
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
                  className="shrink-0 rounded-md border border-line-strong px-2 py-1 text-xs hover:bg-hover disabled:opacity-50"
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
      return "No seats available. Add seats in billing first.";
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
