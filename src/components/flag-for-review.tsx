"use client";

/**
 * Flag-for-review button + consent modal.
 *
 * The customer hits "Flag for review" on a check result; the modal
 * captures (1) what they think is off, (2) optional note, (3) required
 * consent. On submit, POSTs to /api/customer-flag and the row lands
 * in /admin/customer-flags for the founder to triage.
 *
 * Privacy contract:
 *   - The consent box is never pre-checked. The submit button stays
 *     disabled until the customer ticks it.
 *   - The modal copy explicitly says what we do with the text.
 *   - The button is opt-in. Customers who never click it never share
 *     their strings. (Other guard rails — pii-screen, sentry-scrub,
 *     safe-error-log — apply on every text-bearing route regardless.)
 *
 * Brand voice: calm, direct, plain. Mirrors the suggestion-quality
 * rules — no "Please feel free to," no em dashes, no "rest assured."
 */

import { useEffect, useId, useRef, useState } from "react";

export type FlagReason =
  | "wrong_verdict"
  | "wrong_suggestion"
  | "should_have_flagged"
  | "standard_unclear"
  | "other";

const REASON_LABEL: Record<FlagReason, string> = {
  wrong_verdict: "The verdict's wrong",
  wrong_suggestion: "The suggestion's wrong",
  should_have_flagged: "Something's wrong but nothing fired",
  standard_unclear: "The standard isn't clear",
  other: "Something else",
};

export interface FlagForReviewProps {
  text: string;
  contentType?: string | null;
  moment?: string | null;
  verdict?: "pass" | "violation" | "review_recommended" | null;
  /** Source surface — defaults to "dashboard" when omitted. */
  source?: "dashboard" | "plugin" | "cli" | "action" | "lsp" | "mcp";
}

type Status = "idle" | "submitting" | "submitted" | "error";

export function FlagForReview({
  text,
  contentType,
  moment,
  verdict,
  source = "dashboard",
}: FlagForReviewProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason>("wrong_verdict");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonId = useId();
  const noteId = useId();
  const consentId = useId();

  // ESC closes; click outside the dialog closes; trap focus minimally
  // (autofocus the dialog when it opens).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (status === "submitted") {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-400">
        Flagged. Robert will look at it.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-stone-600 underline underline-offset-2 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
      >
        Flag for review
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${consentId}-title`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="w-full max-w-lg rounded-lg border border-stone-200 bg-white p-6 shadow-xl outline-none dark:border-stone-700 dark:bg-stone-900"
          >
            <header className="space-y-2">
              <h2
                id={`${consentId}-title`}
                className="text-lg font-semibold text-stone-900 dark:text-stone-100"
              >
                Flag for review
              </h2>
              <p className="text-sm text-stone-600 dark:text-stone-300">
                You&rsquo;re sending this check to Robert to review.
                He&rsquo;ll see the original text, the verdict, and your
                note. With your consent, the check can be used to
                refine the rulesets and improve the model.
              </p>
            </header>

            <form
              className="mt-5 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!consent || status === "submitting") return;
                setStatus("submitting");
                setErrorMessage(null);
                try {
                  const res = await fetch("/api/customer-flag", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      text,
                      content_type: contentType ?? undefined,
                      moment: moment ?? undefined,
                      verdict: verdict ?? undefined,
                      flag_reason: reason,
                      customer_note: note.trim() || undefined,
                      source,
                      consent: true,
                    }),
                  });
                  if (!res.ok) {
                    const body = (await res.json().catch(() => null)) as
                      | { error?: string }
                      | null;
                    throw new Error(
                      body?.error ?? `Request failed (${res.status})`,
                    );
                  }
                  setStatus("submitted");
                  setOpen(false);
                } catch (err) {
                  setStatus("error");
                  setErrorMessage(
                    err instanceof Error
                      ? err.message
                      : "Could not record the flag. Try again in a moment.",
                  );
                }
              }}
            >
              <fieldset>
                <legend
                  id={reasonId}
                  className="text-sm font-medium text-stone-800 dark:text-stone-200"
                >
                  What&rsquo;s off?
                </legend>
                <div
                  role="radiogroup"
                  aria-labelledby={reasonId}
                  className="mt-2 space-y-1"
                >
                  {(Object.keys(REASON_LABEL) as FlagReason[]).map((r) => (
                    <label
                      key={r}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-stone-800 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                    >
                      <input
                        type="radio"
                        name="flag-reason"
                        value={r}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                        className="accent-stone-700 dark:accent-stone-300"
                      />
                      {REASON_LABEL[r]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label
                  htmlFor={noteId}
                  className="text-sm font-medium text-stone-800 dark:text-stone-200"
                >
                  Note (optional)
                </label>
                <textarea
                  id={noteId}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Anything else worth knowing?"
                  className="mt-1 w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                />
              </div>

              <label
                htmlFor={consentId}
                className="flex items-start gap-2 rounded border border-stone-200 bg-stone-50 p-3 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200"
              >
                <input
                  id={consentId}
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 accent-stone-700 dark:accent-stone-300"
                />
                <span>
                  I consent to ContentRX seeing this string and using it
                  to refine the rulesets and improve the model.
                </span>
              </label>

              {errorMessage && (
                <p className="text-sm text-red-700 dark:text-red-400">
                  {errorMessage}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!consent || status === "submitting"}
                  className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
                >
                  {status === "submitting" ? "Flagging…" : "Flag for review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
