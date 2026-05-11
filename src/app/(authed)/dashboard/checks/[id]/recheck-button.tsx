"use client";

/**
 * "Re-run this check" CTA on /dashboard/checks/[id].
 *
 * Posts the stored full input back through /api/check (same path the
 * paste panel + Figma plugin use), then routes the customer to the
 * fresh check's detail page using the `check_id` returned in the
 * response envelope.
 *
 * Quota-aware: a re-run consumes a check from the customer's monthly
 * limit. The button is explicit about that — no surprise charges, no
 * silent re-billing. We don't try to pre-deduct on the client; quota
 * enforcement lives server-side in claimQuotaSlot. A 402 surfaces as
 * a clear "monthly limit reached" message.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RecheckButtonProps {
  text: string;
  contentType: string | null;
  moment: string | null;
}

type Status = "idle" | "submitting" | "error";

export function RecheckButton({
  text,
  contentType,
  moment,
}: RecheckButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onClick() {
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          // Forward the original taxonomy hints so the engine doesn't
          // have to re-classify. Both are optional on the wire; we send
          // them only when the stored row has them.
          ...(contentType ? { content_type: contentType } : {}),
          ...(moment ? { moment } : {}),
          source: "dashboard",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        // 402 = quota exhausted. Surface the server's message verbatim
        // when present (it already reads as a customer message), with
        // a sensible fallback otherwise.
        const fallback =
          res.status === 402
            ? "You've used every check in this month's limit. Upgrade or wait for the reset."
            : `Re-run failed (${res.status}).`;
        throw new Error(body?.error ?? fallback);
      }
      const body = (await res.json()) as { check_id?: string };
      if (typeof body.check_id !== "string" || body.check_id.length === 0) {
        // Server is on an older deploy that doesn't return check_id —
        // fall back to the list view so the customer at least sees
        // their fresh check.
        router.push("/dashboard/checks");
        router.refresh();
        return;
      }
      router.push(`/dashboard/checks/${body.check_id}`);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Re-run failed.",
      );
    }
  }

  if (status === "error" && errorMessage) {
    return (
      <div className="flex flex-col items-end gap-2">
        <p className="text-xs text-accent-concern-text">{errorMessage}</p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setErrorMessage(null);
          }}
          className="rounded-md border border-line bg-raised px-2.5 py-1 text-xs font-medium text-default hover:bg-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "submitting"}
      className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-raised px-3 py-1.5 text-sm font-medium text-default transition-colors hover:bg-hover disabled:opacity-60"
    >
      {status === "submitting" ? "Running…" : "Re-run this check"}
      <span className="text-xs text-quiet">
        (uses 1 check from your monthly limit)
      </span>
    </button>
  );
}
