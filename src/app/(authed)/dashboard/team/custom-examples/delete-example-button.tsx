/**
 * Delete button for /dashboard/team/custom-examples.
 *
 * Small client island. DELETEs the entry via the admin API with a
 * confirm step, then refreshes the route so the row disappears
 * without a full page reload.
 *
 * Human-eval build plan Session 30 PR B.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteExampleButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirming" | "deleting" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function doDelete() {
    setState("deleting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/team-custom-examples/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Delete failed.");
      setState("error");
    }
  }

  if (state === "confirming") {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={doDelete}
          className="rounded border border-red-500 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="text-[11px] text-neutral-500 underline"
        >
          Cancel
        </button>
      </span>
    );
  }

  if (state === "deleting") {
    return <span className="text-[11px] text-neutral-500">Deleting…</span>;
  }

  if (state === "error") {
    return (
      <span className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={doDelete}
          className="rounded border border-red-400 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
        >
          Retry
        </button>
        {errorMessage && (
          <span className="text-[10px] text-red-700 dark:text-red-400">
            {errorMessage}
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setState("confirming")}
      className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900"
    >
      Delete
    </button>
  );
}
