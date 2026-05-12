"use client";

/**
 * Flag-for-Review button + consent modal.
 *
 * Per ADR 2026-05-11 this is the only path by which a customer check
 * enters ContentRX's calibration log. The customer taps Flag for
 * Review on a check result; the modal captures (1) what they think is
 * off, (2) optional note, (3) required consent. On submit, POSTs to
 * /api/customer-flag and the row lands in /admin/customer-flags for
 * triage. The customer can revoke a shared check from
 * /dashboard/shared (the RevokeButton there calls DELETE /api/customer-flag/[id]).
 *
 * Consent contract:
 *   - The consent box is never pre-checked. The submit button stays
 *     disabled until the customer ticks it.
 *   - The modal copy names the consent in plain terms: what's stored,
 *     what it's used for, how to revoke.
 *   - The button is opt-in. Customers who never click it never share
 *     their strings. (Guard rails pii-screen, sentry-scrub,
 *     safe-error-log apply on every text-bearing route regardless.)
 *
 * Brand voice: ContentRX framing, no first-person, no em dashes, no
 * semicolons, no colons in body sentences, singular they.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type FlagReason =
  | "doesnt_match_experience"
  | "lacks_context"
  | "not_clear_helpful_concise";

const REASON_LABEL: Record<FlagReason, string> = {
  doesnt_match_experience: "Content doesn't match the experience",
  lacks_context: "Content lacks context",
  not_clear_helpful_concise: "Content isn't clear, helpful, or concise",
};

export interface FlagForReviewProps {
  text: string;
  contentType?: string | null;
  moment?: string | null;
  verdict?: "pass" | "violation" | "review_recommended" | null;
  /** When the flag is for a specific finding (per-finding "Flag"
   * button on a FindingCard), the violation's id. The admin inbox
   * uses this to cross-reference with the original violation row. */
  violationId?: string | null;
  /** Optional preface in the modal — used to specify the finding the
   * flag is about. Shown above the form so the customer sees what
   * they're flagging. */
  contextLine?: string | null;
  /** Variant: a small text button (default) or a per-finding button
   * styled like the surrounding finding-card actions. */
  variant?: "link" | "card-action";
  /** Explicit button label override. Wins over the variant default
   * when provided. Used on /dashboard/checks where the row has
   * room for the full "Flag for review" string even on the
   * card-action variant. */
  label?: string;
  /** Source surface — defaults to "dashboard" when omitted. */
  source?: "dashboard" | "plugin" | "cli" | "action" | "lsp" | "mcp";
}

type Status = "idle" | "submitting" | "submitted" | "error";

export function FlagForReview({
  text,
  contentType,
  moment,
  verdict,
  violationId,
  contextLine,
  variant = "link",
  label,
  source = "dashboard",
}: FlagForReviewProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason>("doesnt_match_experience");
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
      <p className="text-xs text-accent-affirm-text">
        Shared. Visible to you on the Shared checks tab.
      </p>
    );
  }

  // Both variants use design-token semantic classes. The `link` variant
  // (used in VerdictHeader, inline with the verdict pill) used to be a
  // raw-stone underlined-link that read as broken at full contrast — a
  // known a11y antipattern flagged in the doc-tier v2.1 critique. It's
  // now a quiet secondary button: visible enough to invite the action
  // (a customer disagreeing with the verdict is high-signal calibration
  // data), subordinate enough to not compete with the verdict pill.
  // The `card-action` variant matches the rest of the per-finding
  // toolbar so the flag affordance reads as a peer of Adjust + Make a
  // rule on each finding row.
  const triggerClassName =
    variant === "card-action"
      ? "shrink-0 rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs font-medium text-default transition-colors hover:bg-hover"
      : "shrink-0 rounded-md border border-line bg-raised px-2.5 py-1 text-xs font-medium text-default transition-colors hover:bg-hover";
  const triggerLabel =
    label ?? (variant === "card-action" ? "Flag" : "Flag for review");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          variant === "card-action"
            ? "Flag this finding for review"
            : "Flag for review"
        }
        className={triggerClassName}
      >
        {triggerLabel}
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
            className="w-full max-w-lg rounded-lg border border-line bg-raised p-6 shadow-xl outline-none"
          >
            <header className="space-y-2">
              <h2
                id={`${consentId}-title`}
                className="text-lg font-semibold text-strong"
              >
                Share this check with ContentRX
              </h2>
              <p className="text-sm text-default">
                Sharing means ContentRX stores the plaintext of this
                check and uses it to calibrate the engine so future
                suggestions improve.
              </p>
              <p className="text-sm text-default">
                <strong>What gets stored</strong>. This exact check,
                the finding it produced, the time you shared it, and
                the content type. Nothing else from this session.
              </p>
              <p className="text-sm text-default">
                <strong>What ContentRX does with it</strong>. A content
                designer reviews shared checks by hand. Patterns inform
                how the engine reasons. Your check is not sold or given
                to any third party.
              </p>
              <p className="text-sm text-default">
                <strong>How to revoke</strong>. Open the{" "}
                <span className="font-medium text-strong">Shared checks</span>
                {" "}tab on your dashboard and tap{" "}
                <span className="font-medium text-strong">Remove this check</span>
                . ContentRX deletes the row and any record it produced
                in the calibration log.
              </p>
              {contextLine && (
                <p className="rounded-md border border-line bg-sunken px-3 py-2 text-xs text-default">
                  {contextLine}
                </p>
              )}
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
                      violation_id: violationId ?? undefined,
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
                  className="text-sm font-medium text-default"
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
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-default hover:bg-hover"
                    >
                      <input
                        type="radio"
                        name="flag-reason"
                        value={r}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                        className="accent-strong"
                      />
                      {REASON_LABEL[r]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label
                  htmlFor={noteId}
                  className="text-sm font-medium text-default"
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
                  className="mt-1 w-full resize-y rounded-md border border-line-strong bg-raised px-3 py-2 text-sm text-strong focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <label
                htmlFor={consentId}
                className="flex items-start gap-2 rounded border border-line bg-sunken p-3 text-sm text-default"
              >
                <input
                  id={consentId}
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 accent-strong"
                />
                <span>
                  Share this check with ContentRX and consent to its
                  use for engine calibration.
                </span>
              </label>

              {errorMessage && (
                <p className="text-sm text-accent-concern-text">
                  {errorMessage}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-default hover:bg-hover"
                >
                  Cancel
                </button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!consent || status === "submitting"}
                >
                  {status === "submitting" ? "Sharing…" : "Confirm and share"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
