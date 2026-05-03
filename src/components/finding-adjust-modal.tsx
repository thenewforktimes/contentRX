"use client";

/**
 * FindingAdjustModal — the customer's path for telling ContentRX
 * "you got this wrong" on a check finding.
 *
 * Block 1c of the calibration plan. Implements the Adjust modal
 * specified in ADR 2026-04-29 §4: two checkable dimensions in one
 * save (verdict and/or suggestion), default-OFF upstream-share
 * checkbox, PII-screening on every text field server-side.
 *
 * Why one modal, two dimensions: the user's actual disagreement is
 * usually one of three flavors — "the call was wrong", "the call
 * was right but the fix is wrong", or both. Forcing a single-intent
 * picker would either (a) lose the connection between correlated
 * disagreements or (b) require multiple round-trips. The two-
 * checkbox shape captures both signals from one click without
 * requiring the user to pre-categorize their disagreement.
 *
 * Substrate boundary (ADR 2026-04-25): this component sees only
 * public-envelope fields. The submitted text + the LLM's
 * suggestion + the user's rewrite are the only payload. The server
 * route correlates against the violations table to recover
 * (moment, content_type, standard_id) for substrate-side storage.
 */

import { useEffect, useId, useState } from "react";
import { buttonStyles } from "@/components/ui/button";
import {
  OVERRIDE_REASON_META,
  type OverrideReasonCode,
} from "@/lib/override-reasons";

// The 3 verdict-disagreement codes shown in the Adjust modal. The
// other two from override-reasons.ts (`fix_is_worse`,
// `shipping_anyway`) belong to different flows: fix_is_worse is
// captured by the suggestion-rewrite dimension below; shipping_anyway
// belongs on Ship-anyway-gated surfaces (CLI, GH Action, LSP).
const VERDICT_REASON_CODES: ReadonlyArray<OverrideReasonCode> = [
  "not_applicable_here",
  "standard_too_strict",
  "confusing_need_more_context",
];

export interface FindingAdjustModalProps {
  open: boolean;
  onClose: () => void;
  /** The text the customer originally checked. */
  submittedText: string;
  /** The LLM's current suggestion (pre-fills the rewrite textarea). */
  currentSuggestion: string;
  /** The public-envelope issue text — passed through for clustering. */
  issue: string;
  /** Called after a successful save with the response payload, so the
   *  parent can collapse the finding card and show the user's
   *  rewrite (if any) inline. */
  onSaved: (saved: {
    verdictRecorded: boolean;
    rewriteRecorded: boolean;
    rewriteText: string | null;
  }) => void;
}

type SubmitState = "idle" | "submitting" | "error";

export function FindingAdjustModal({
  open,
  onClose,
  submittedText,
  currentSuggestion,
  issue,
  onSaved,
}: FindingAdjustModalProps) {
  const verdictBoxId = useId();
  const suggestionBoxId = useId();
  const upstreamBoxId = useId();

  const [verdictChecked, setVerdictChecked] = useState(false);
  const [suggestionChecked, setSuggestionChecked] = useState(false);
  const [reasonCode, setReasonCode] = useState<OverrideReasonCode>(
    "not_applicable_here",
  );
  const [notes, setNotes] = useState("");
  const [rewrite, setRewrite] = useState(currentSuggestion);
  const [shareUpstream, setShareUpstream] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset local state when the modal opens with a fresh finding —
  // otherwise the previous finding's rewrite leaks into the next one.
  useEffect(() => {
    if (!open) return;
    setVerdictChecked(false);
    setSuggestionChecked(false);
    setReasonCode("not_applicable_here");
    setNotes("");
    setRewrite(currentSuggestion);
    setShareUpstream(false);
    setSubmitState("idle");
    setErrorMessage(null);
  }, [open, currentSuggestion]);

  if (!open) return null;

  const canSubmit =
    submitState !== "submitting" && (verdictChecked || suggestionChecked);

  const onSubmit = async () => {
    setSubmitState("submitting");
    setErrorMessage(null);

    const signalType: "verdict" | "suggestion" | "both" =
      verdictChecked && suggestionChecked
        ? "both"
        : verdictChecked
          ? "verdict"
          : "suggestion";

    const body: Record<string, unknown> = {
      text: submittedText,
      signal_type: signalType,
      issue,
      share_upstream: shareUpstream,
    };
    if (verdictChecked) {
      body.override_reason_code = reasonCode;
      if (notes.trim()) body.override_notes = notes.trim();
    }
    if (suggestionChecked) {
      body.rewrite_text = rewrite;
    }

    try {
      const res = await fetch("/api/violations/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          typeof (data as { error?: unknown })?.error === "string"
            ? (data as { error: string }).error
            : "Couldn't save adjustment. Try again.";
        setErrorMessage(msg);
        setSubmitState("error");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        recorded?: { verdict?: boolean; suggestion?: boolean };
      };
      onSaved({
        verdictRecorded: Boolean(data.recorded?.verdict),
        rewriteRecorded: Boolean(data.recorded?.suggestion),
        rewriteText: suggestionChecked ? rewrite : null,
      });
    } catch {
      setErrorMessage("Couldn't reach the server. Check your connection.");
      setSubmitState("error");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Adjust this finding"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-stone-200 bg-white shadow-xl dark:border-stone-800 dark:bg-stone-950">
        <header className="border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            Adjust this finding
          </h2>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Tell ContentRX what to change. Check whichever applies.
          </p>
        </header>

        <div className="space-y-5 px-5 py-5">
          {/* ──────────────── Verdict dimension ──────────────── */}
          <section>
            <label className="flex items-start gap-3 text-sm">
              <input
                id={verdictBoxId}
                type="checkbox"
                checked={verdictChecked}
                onChange={(e) => setVerdictChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 dark:border-stone-700"
              />
              <span className="flex-1">
                <span className="font-medium text-stone-900 dark:text-stone-100">
                  Adjust the verdict
                </span>
                <span className="mt-0.5 block text-stone-600 dark:text-stone-400">
                  This isn&apos;t a finding for your team&apos;s context.
                </span>
              </span>
            </label>

            {verdictChecked && (
              <div className="mt-3 space-y-3 pl-7">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
                    Reason
                  </label>
                  <select
                    value={reasonCode}
                    onChange={(e) =>
                      setReasonCode(e.target.value as OverrideReasonCode)
                    }
                    className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  >
                    {VERDICT_REASON_CODES.map((code) => (
                      <option key={code} value={code}>
                        {OVERRIDE_REASON_META[code].label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {OVERRIDE_REASON_META[reasonCode].description}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
                    Notes <span className="font-normal text-stone-500 dark:text-stone-400">(optional)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                    placeholder="Anything else that would help us calibrate?"
                  />
                </div>
              </div>
            )}
          </section>

          {/* ──────────────── Suggestion dimension ──────────────── */}
          <section>
            <label className="flex items-start gap-3 text-sm">
              <input
                id={suggestionBoxId}
                type="checkbox"
                checked={suggestionChecked}
                onChange={(e) => setSuggestionChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 dark:border-stone-700"
              />
              <span className="flex-1">
                <span className="font-medium text-stone-900 dark:text-stone-100">
                  Adjust the suggestion
                </span>
                <span className="mt-0.5 block text-stone-600 dark:text-stone-400">
                  Write the version you&apos;d ship below.
                </span>
              </span>
            </label>

            {suggestionChecked && (
              <div className="mt-3 pl-7">
                <textarea
                  value={rewrite}
                  onChange={(e) => setRewrite(e.target.value)}
                  rows={3}
                  maxLength={100_000}
                  className="block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  placeholder="Your version"
                />
              </div>
            )}
          </section>

          {/* ──────────────── Upstream-share opt-in ──────────────── */}
          {(verdictChecked || suggestionChecked) && (
            <section className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/50">
              <label className="flex items-start gap-3 text-sm">
                <input
                  id={upstreamBoxId}
                  type="checkbox"
                  checked={shareUpstream}
                  onChange={(e) => setShareUpstream(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 dark:border-stone-700"
                />
                <span className="flex-1">
                  <span className="font-medium text-stone-900 dark:text-stone-100">
                    Help calibrate the ContentRX model
                  </span>
                  <span className="mt-0.5 block text-stone-600 dark:text-stone-400">
                    Your edit becomes a candidate for review. Only
                    approved suggestions reach the model. Off by
                    default.
                  </span>
                </span>
              </label>
            </section>
          )}

          {errorMessage && (
            <p
              role="alert"
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-stone-200 px-5 py-3 dark:border-stone-800">
          <button
            type="button"
            onClick={onClose}
            className={buttonStyles({ variant: "ghost", size: "sm" })}
            disabled={submitState === "submitting"}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className={buttonStyles({ variant: "primary", size: "sm" })}
          >
            {submitState === "submitting" ? "Saving…" : "Save adjustment"}
          </button>
        </footer>
      </div>
    </div>
  );
}
