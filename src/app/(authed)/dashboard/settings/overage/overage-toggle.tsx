"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/**
 * 2026-05-14 a11y fix — was a plain <Button> that flipped its own
 * label on each click, with no `aria-pressed` and no announcement
 * that state had changed. Screen reader users heard "Enable overage
 * button" → click → silently re-rendered → "Disable overage button"
 * with no signal that their action took effect.
 *
 * Fix: kept the Button (visual treatment unchanged) but added
 * `aria-pressed={active}` so the toggle state is programmatically
 * determinable (WCAG 4.1.2 Name, Role, Value). The button text +
 * variant flip remains the sighted cue; `aria-pressed` is the AT
 * cue; a separate `aria-live="polite"` region below the button
 * announces "Overage enabled" / "Overage disabled" after the server
 * save completes, so SR users get an explicit state-change cue.
 */
export function OverageToggle({
  initialActive,
  initialOptedInAt,
}: {
  initialActive: boolean;
  initialOptedInAt: string | null;
}) {
  const [active, setActive] = useState(initialActive);
  const [optedInAt, setOptedInAt] = useState<string | null>(initialOptedInAt);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Status message for the live region. Cleared on re-toggle so the
  // SR doesn't re-announce stale state on subsequent saves.
  const [statusMessage, setStatusMessage] = useState<string>("");

  function submit(next: boolean) {
    setError(null);
    setStatusMessage("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/overage-opt-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: next }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            body?.error ??
              "We couldn't save the change. Try again. If it keeps happening, email hello@contentrx.io.",
          );
        }
        const body = await res.json();
        setActive(body.active);
        setOptedInAt(body.optedInAt ?? null);
        setStatusMessage(
          body.active ? "Overage enabled" : "Overage disabled",
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "We couldn't save the change. Try again.",
        );
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => submit(!active)}
          disabled={isPending}
          variant={active ? "secondary" : "primary"}
          aria-pressed={active}
          aria-busy={isPending || undefined}
        >
          {isPending
            ? "Saving…"
            : active
              ? "Disable overage"
              : "Enable overage"}
        </Button>
        <span className="text-xs text-quiet">
          {active
            ? `Active${
                optedInAt
                  ? ` since ${new Date(optedInAt).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric", year: "numeric" },
                    )}`
                  : ""
              }`
            : "Off · hard cap on your monthly limit"}
        </span>
      </div>
      {/*
       * Live region — announces the state change after the server
       * save completes. `aria-atomic` so the entire message is
       * re-read. `sr-only` since sighted users have the button-text
       * + variant flip as their cue.
       */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {statusMessage}
      </p>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-accent-concern-border bg-accent-concern-soft p-3 text-xs text-accent-concern-text"
        >
          {error}
        </div>
      )}
    </div>
  );
}
