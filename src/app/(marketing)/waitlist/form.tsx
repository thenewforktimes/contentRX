/**
 * Waitlist form (client component).
 *
 * Captures email + the region tag the middleware passed via query param
 * and POSTs to /api/waitlist. The endpoint sends a notification email
 * to the founder via Resend, deduped per (email, day). On success the
 * form is replaced by an inline thank-you state. On failure the user
 * sees a non-alarming error message that names the manual fallback
 * (email hello@contentrx.io).
 *
 * Voice: ContentRX-third-person, no em dashes, no semicolons.
 * Matches /privacy + /terms.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

export function WaitlistForm({ initialRegion }: { initialRegion: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.status === "submitting") return;

    setState({ status: "submitting" });

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, region: initialRegion }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setState({
          status: "error",
          message:
            body?.error ??
            "Could not record your signup. Try again in a few minutes, or email hello@contentrx.io.",
        });
        return;
      }

      setState({ status: "success" });
    } catch {
      setState({
        status: "error",
        message:
          "Network error reaching ContentRX. Try again in a few minutes, or email hello@contentrx.io.",
      });
    }
  }

  if (state.status === "success") {
    return (
      <div className="mt-10 rounded-lg border border-accent-affirm-border bg-accent-affirm-soft p-6 text-sm text-accent-affirm-text">
        <p className="font-medium">Got it.</p>
        <p className="mt-2">
          ContentRX will email you when access opens in your region.
          That email comes from <code>hello@contentrx.io</code>. Worth
          adding to your safe-senders so it does not land in spam.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-10 space-y-4">
      <div>
        <label
          htmlFor="waitlist-email"
          className="block text-sm font-medium text-strong"
        >
          Email
        </label>
        <Input
          id="waitlist-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state.status === "submitting"}
          className="mt-1.5"
        />
      </div>

      {initialRegion ? (
        <p className="text-xs text-quiet">
          Detected region. <code>{initialRegion}</code>. ContentRX will
          tell you when access opens there.
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={state.status === "submitting" || !email}
      >
        {state.status === "submitting" ? "Joining..." : "Join the waitlist"}
      </Button>

      {state.status === "error" ? (
        <p
          role="alert"
          className="text-sm text-accent-concern-text"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
