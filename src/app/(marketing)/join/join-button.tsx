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
        // The server returns a customer-ready message in `error`. Fall
        // back to a generic message if the response shape is unexpected.
        throw new Error(
          body.error ??
            "Couldn't accept the invitation. Try again. If it keeps happening, email hello@contentrx.io.",
        );
      }
      router.push("/dashboard?joined=1");
      router.refresh();
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't accept the invitation. Try again. If it keeps happening, email hello@contentrx.io.",
      );
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onAccept}
        disabled={state === "submitting"}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50 dark:bg-emerald-400 dark:text-emerald-950 dark:hover:bg-emerald-300"
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

