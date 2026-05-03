"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
      <section className="rounded-lg border border-stone-200 p-5 dark:border-stone-800">
        <h2 className="text-sm font-semibold">Invite a teammate</h2>
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
          They&apos;ll get an email with a link that&apos;s good for 7 days.
          {seatsAvailable === 0 && (
            <>
              {" "}
              No seats available. Add seats from billing first.
            </>
          )}
        </p>
        <form onSubmit={onInvite} className="mt-3 flex flex-wrap gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            required
            disabled={state === "submitting" || seatsAvailable === 0}
            className="flex-1 min-w-[240px] rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
          />
          <Button
            type="submit"
            disabled={state === "submitting" || seatsAvailable === 0 || !email.trim()}
            size="sm"
          >
            {state === "submitting" ? "Sending…" : "Send invite"}
          </Button>
        </form>
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
          >
            {error}
          </p>
        )}
        {state === "success" && (
          <p className="mt-3 text-xs text-green-700 dark:text-green-400">
            Invite sent.
          </p>
        )}
      </section>

      {pendingInvitations.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Pending invitations</h2>
          <ul className="flex flex-col gap-2">
            {pendingInvitations.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-md border border-stone-200 p-3 text-sm dark:border-stone-800"
              >
                <div>
                  <p className="font-medium">{p.email}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Sent {formatDate(p.createdAt)} · expires{" "}
                    {formatDate(p.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(p.id)}
                  disabled={revokingId === p.id}
                  className="shrink-0 rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-900"
                >
                  {revokingId === p.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Members</h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-4 rounded-md border border-stone-200 p-3 text-sm dark:border-stone-800"
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
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Joined {formatDate(m.joinedAt)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
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
