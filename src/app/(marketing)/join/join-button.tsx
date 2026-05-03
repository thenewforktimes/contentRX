"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";

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
      <Button onClick={onAccept} disabled={state === "submitting"}>
        {state === "submitting" ? "Joining…" : "Accept invitation"}
      </Button>
      {error && (
        <div role="alert" className="mt-3">
          <Pill tone="red">{error}</Pill>
        </div>
      )}
    </div>
  );
}

