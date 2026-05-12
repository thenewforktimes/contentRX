"use client";

/**
 * Per-card "Remove this check" button on /dashboard/shared.
 *
 * Robert's call (2026-05-10): customers should never have to email
 * to revoke a check they didn't mean to share. This button is the
 * in-product revoke. Two clicks to fire (the button, then the
 * confirmation), matching the two-CTA bar the consent modal sets
 * for the share direction.
 *
 * On confirm: DELETE /api/customer-flag/[id]. The route checks
 * ownership server-side. On success, the page refreshes so the
 * row disappears from the list.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    "idle" | "confirming" | "submitting" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onConfirm() {
    setState("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/customer-flag/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setState("error");
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not remove the check. Try again in a moment.",
      );
    }
  }

  if (state === "confirming" || state === "submitting") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-default">
          This deletes the check from the calibration log.
        </span>
        <button
          type="button"
          onClick={onConfirm}
          disabled={state === "submitting"}
          className="rounded-md bg-accent-concern px-2.5 py-1 font-medium text-accent-concern-on hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "submitting" ? "Removing…" : "Yes, remove"}
        </button>
        <button
          type="button"
          onClick={() => {
            setState("idle");
            setErrorMessage(null);
          }}
          disabled={state === "submitting"}
          className="rounded-md border border-line bg-raised px-2.5 py-1 font-medium text-default hover:bg-hover"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {errorMessage && (
        <span className="text-accent-concern-text" role="alert">
          {errorMessage}
        </span>
      )}
      <button
        type="button"
        onClick={() => setState("confirming")}
        aria-label="Remove this check from the calibration log"
        className="rounded-md border border-line-strong bg-raised px-2.5 py-1 font-medium text-default hover:bg-hover"
      >
        Remove this check
      </button>
    </div>
  );
}
