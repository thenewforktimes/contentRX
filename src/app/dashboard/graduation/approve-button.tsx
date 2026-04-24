"use client";

/**
 * Small client island for the graduation-approval button.
 *
 * The rest of /dashboard/graduation is a server component; this bit
 * needs JS to POST the approval + update the UI. Keeps the client
 * bundle small.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GraduationLevel } from "@/lib/graduation";

export function ApproveButton({
  standardId,
  targetLevel,
  criteriaSnapshot,
}: {
  standardId: string;
  targetLevel: GraduationLevel;
  criteriaSnapshot: unknown;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    if (state !== "idle") return;

    const reason = window.prompt(
      `Approving graduation to ${targetLevel}. Short reason for the audit log:`,
    );
    if (!reason) return;

    setState("loading");
    try {
      const res = await fetch("/api/graduation/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standard_id: standardId,
          target_level: targetLevel,
          reason,
          readiness_snapshot: criteriaSnapshot,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setState("done");
      setMessage(`Promoted ${standardId} → ${targetLevel}.`);
      router.refresh();
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Approval failed.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={state !== "idle"}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {state === "loading"
          ? "Approving…"
          : state === "done"
          ? "Approved ✓"
          : state === "error"
          ? "Retry"
          : "Approve graduation"}
      </button>
      {message && (
        <p
          className={`text-[10px] ${
            state === "error"
              ? "text-red-700 dark:text-red-400"
              : "text-neutral-500"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
