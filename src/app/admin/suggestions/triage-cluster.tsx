"use client";

/**
 * TriageCluster — one (moment, content_type, standard_id) cluster
 * card on the /admin/suggestions queue. Shows the candidate rewrites
 * with Approve / Edit / Reject controls.
 *
 * Block 2b of the calibration plan. Designed for the founder's
 * 60-second-daily annotation rhythm: the cluster bucket label is at
 * the top, candidate rewrites with vote counts inline, three action
 * buttons. Edit reveals a textarea pre-filled with the most-frequent
 * candidate text so Robert can tweak before promoting.
 *
 * Keyboard shortcuts (when this card is the focused/last-interacted
 * cluster): A = Approve top candidate, R = Reject all, E = Edit.
 * Implementation deferred to Block 2b.1; for now buttons are
 * mouse-driven.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pill } from "@/components/ui/pill";

interface CandidatePayload {
  id: string;
  candidateText: string;
  issueContext: string;
  source: string;
  createdAt: string;
}

export interface TriageClusterProps {
  moment: string | null;
  contentType: string | null;
  standardId: string | null;
  momentLabel: string;
  contentTypeLabel: string;
  candidateCount: number;
  candidates: CandidatePayload[];
}

type Mode = "idle" | "editing" | "submitting" | "done" | "error";

export function TriageCluster({
  moment,
  contentType,
  standardId,
  momentLabel,
  contentTypeLabel,
  candidateCount,
  candidates,
}: TriageClusterProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editText, setEditText] = useState(
    candidates[0]?.candidateText ?? "",
  );
  const [resultLabel, setResultLabel] = useState<string | null>(null);

  const allIds = candidates.map((c) => c.id);
  const canApprove = Boolean(moment && contentType && standardId);

  const onAction = async (action: "approve" | "reject", text?: string) => {
    setMode("submitting");
    setErrorMessage(null);
    try {
      const body: Record<string, unknown> = {
        action,
        candidate_ids: allIds,
      };
      if (action === "approve") {
        body.approved_text = text ?? candidates[0]?.candidateText ?? "";
        body.moment = moment;
        body.content_type = contentType;
        body.standard_id = standardId;
      }
      const res = await fetch(
        "/api/admin/suggestion-candidates/triage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          typeof (data as { error?: unknown })?.error === "string"
            ? (data as { error: string }).error
            : "Couldn't triage. Try again.";
        setErrorMessage(msg);
        setMode("error");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        precedent_id?: string;
        merged?: number;
        rejected?: number;
      };
      setMode("done");
      if (action === "approve") {
        setResultLabel(
          `Promoted ${data.merged ?? allIds.length} candidate${
            (data.merged ?? allIds.length) === 1 ? "" : "s"
          } to a precedent.`,
        );
      } else {
        setResultLabel(
          `Rejected ${data.rejected ?? allIds.length} candidate${
            (data.rejected ?? allIds.length) === 1 ? "" : "s"
          }.`,
        );
      }
      // Refresh the page-level data so next render shows the updated
      // queue.
      router.refresh();
    } catch {
      setErrorMessage("Couldn't reach the server.");
      setMode("error");
    }
  };

  if (mode === "done") {
    return (
      <article className="rounded-md border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
        <p className="font-mono text-xs text-emerald-700 dark:text-emerald-300">
          {momentLabel} · {contentTypeLabel} · {standardId ?? "—"}
        </p>
        <p className="mt-1 text-default">
          {resultLabel}
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-md border border-line bg-white p-4 text-sm dark:bg-stone-900">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-quiet">
            {momentLabel} · {contentTypeLabel} · {standardId ?? "—"}
          </p>
          <Pill tone="neutral" size="xs">
            {candidateCount} candidate{candidateCount === 1 ? "" : "s"}
          </Pill>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode(mode === "editing" ? "idle" : "editing")}
            disabled={mode === "submitting"}
            className="rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-hover dark:text-stone-200"
          >
            {mode === "editing" ? "Stop editing" : "Edit"}
          </button>
          <button
            type="button"
            onClick={() => onAction("reject")}
            disabled={mode === "submitting"}
            className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() =>
              onAction("approve", mode === "editing" ? editText : undefined)
            }
            disabled={mode === "submitting" || !canApprove}
            title={
              !canApprove
                ? "Cluster missing bucket axes — can't promote until /admin assigns moment + content_type + standard_id"
                : undefined
            }
            className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/60"
          >
            {mode === "submitting" ? "…" : "Approve"}
          </button>
        </div>
      </header>

      {mode === "editing" && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-default">
            Approved text
          </label>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border border-line-strong bg-white px-2 py-1.5 text-sm text-strong dark:bg-stone-900"
          />
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {candidates.map((c) => (
          <li
            key={c.id}
            className="rounded border border-line bg-stone-50 px-3 py-2 dark:bg-stone-950"
          >
            <p className="text-strong">
              {c.candidateText || (
                <span className="italic text-quiet">
                  (no rewrite text)
                </span>
              )}
            </p>
            {c.issueContext && (
              <p className="mt-1 text-xs text-quiet">
                Issue context: {c.issueContext}
              </p>
            )}
            <p className="mt-1 font-mono text-[10px] text-quiet">
              {c.source} · {c.createdAt.slice(0, 10)}
            </p>
          </li>
        ))}
      </ul>

      {errorMessage && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {errorMessage}
        </p>
      )}
    </article>
  );
}
