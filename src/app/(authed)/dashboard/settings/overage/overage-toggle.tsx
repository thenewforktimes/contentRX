"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

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

  function submit(next: boolean) {
    setError(null);
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
      {error && (
        <div className="rounded-md border border-accent-concern-border bg-accent-concern-soft p-3 text-xs text-accent-concern-text">
          {error}
        </div>
      )}
    </div>
  );
}
