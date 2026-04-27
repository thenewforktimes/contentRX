"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State = "idle" | "submitting" | "error";

export function JoinButton({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setState("submitting");
    setError(null);
    try {
      const res = await fetch("/api/teams/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const reason = body.error ?? `${res.status}`;
        throw new Error(humanizeAcceptError(reason));
      }
      router.push("/dashboard?joined=1");
      router.refresh();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Couldn't join. Try again.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onAccept}
        disabled={state === "submitting"}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {state === "submitting" ? "Joining…" : "Accept invitation"}
      </button>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function humanizeAcceptError(reason: string): string {
  switch (reason) {
    case "not_found":
      return "This invitation no longer exists.";
    case "expired":
      return "This invitation expired. Ask the inviter to send a new one.";
    case "email_mismatch":
      return "Your account email doesn't match the invitation.";
    case "already_accepted":
      return "This invitation has already been used.";
    case "already_team_owner":
      return "You already own a team. Cancel that subscription first.";
    case "already_member":
      return "You're already a member of another team.";
    case "no_seats":
      return "The team has no seats available. Ask them to add seats first.";
    default:
      return `Couldn't join (${reason}).`;
  }
}
