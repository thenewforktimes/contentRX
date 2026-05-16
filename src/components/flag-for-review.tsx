"use client";

/**
 * Flag-for-Review button + consent modal (v2, 2026-05-13).
 *
 * Per ADR 2026-05-11 this is the only path by which a customer check
 * enters ContentRX's calibration corpus. The customer taps Flag for
 * review on a check result; the modal captures (1) what's off in their
 * own words, (2) required consent. On submit, POSTs to /api/customer-flag
 * and the row lands in /admin/customer-flags for triage. The customer
 * can revoke a shared check from /dashboard/shared (the RevokeButton
 * there calls DELETE /api/customer-flag/[id]).
 *
 * What changed in v2 (2026-05-13):
 *   - The three-option radio reason taxonomy (doesnt_match_experience /
 *     lacks_context / not_clear_helpful_concise) is gone. The customer's
 *     own words are higher-signal calibration input than a forced
 *     category, and a content designer can categorise at review time.
 *   - The note went from optional to required. Customers willing to
 *     articulate their disagreement give useful signal. Customers who
 *     would have impulse-flagged with a category and no prose now don't
 *     submit. Lower volume, higher quality.
 *   - Copy reworked top-to-bottom for the legal review pass — gratitude
 *     opener, bulleted disclosure block, warmer confirmation.
 *
 * Consent contract:
 *   - The consent box is never pre-checked. Submit is gated on BOTH
 *     a non-empty textarea AND the consent box being ticked.
 *   - The modal copy names the consent in plain terms: what's stored,
 *     what it's used for, how to revoke.
 *   - The button is opt-in. Customers who never click it never share
 *     their strings. (Guard rails pii-screen, sentry-scrub,
 *     safe-error-log apply on every text-bearing route regardless.)
 *
 * Brand voice: ContentRX framing, no first-person, no em dashes, no
 * semicolons, no colons in body sentences, singular they.
 */

import { useId, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { Button } from "@/components/ui/button";
import { Checkbox, Textarea } from "@/components/ui/input";

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
  source?: "dashboard" | "cli" | "action" | "lsp" | "mcp";
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
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();
  const consentId = useId();

  // Focus management: trap focus, ESC closes, background inert, focus
  // restored to trigger on close. Initial focus goes to the textarea
  // (the user's primary task). Replaces the prior hand-rolled
  // keydown-only handler which didn't trap Tab and didn't restore focus.
  useFocusTrap({
    active: open,
    containerRef: dialogRef,
    onClose: () => setOpen(false),
    initialFocusRef: textareaRef,
  });

  if (status === "submitted") {
    return (
      <p className="text-xs text-accent-affirm-text">
        Thanks. Listed on your Shared checks tab whenever you want to
        look or take it back.
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
  // focus-visible ring shared on both variants — without it, keyboard
  // users tabbing through the per-finding toolbar got no cue at this
  // important entry point (the only path into the calibration consent
  // flow per ADR 2026-05-11). WCAG 2.4.7.
  const triggerFocusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised";
  const triggerClassName =
    variant === "card-action"
      ? `shrink-0 rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs font-medium text-default transition-colors hover:bg-hover ${triggerFocusRing}`
      : `shrink-0 rounded-md border border-line bg-raised px-2.5 py-1 text-xs font-medium text-default transition-colors hover:bg-hover ${triggerFocusRing}`;
  const triggerLabel =
    label ?? (variant === "card-action" ? "Flag" : "Flag for review");

  const noteTrimmed = note.trim();
  const canSubmit =
    consent && noteTrimmed.length > 0 && status !== "submitting";

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
                When a verdict looks off, sharing the check helps
                ContentRX calibrate. Thanks for taking the time.
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
                if (!canSubmit) return;
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
                      customer_note: noteTrimmed,
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
              <div>
                <label
                  htmlFor={noteId}
                  className="text-sm font-medium text-default"
                >
                  What&rsquo;s off?
                </label>
                {/* Migrated from raw <textarea> on 2026-05-14. The old
                    `focus:ring-1` was 1px (below design-system standard
                    of 2px) and fired on mouse click too (should be
                    keyboard-only). The Textarea primitive carries the
                    canonical focus-visible recipe + the new
                    hover:border-line-strong cue. */}
                <Textarea
                  ref={textareaRef}
                  id={noteId}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  required
                  rows={4}
                  maxLength={2000}
                  placeholder="What were you expecting? Anything about the audience or surface helps."
                  className="mt-1"
                />
              </div>

              <div className="rounded border border-line bg-sunken p-3 text-sm text-default">
                <p className="font-medium text-default">Sharing means:</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5">
                  <li>
                    The check, finding, timestamp, and content type go
                    to ContentRX&rsquo;s review queue. Nothing else.
                  </li>
                  <li>
                    Your check is reviewed against the editorial
                    standard to improve future checks.
                  </li>
                  <li>
                    ContentRX never sells or relicenses shared checks.
                  </li>
                  <li>
                    Take it back any time at{" "}
                    <span className="font-medium text-strong">
                      Shared checks
                    </span>
                    {" "}→{" "}
                    <span className="font-medium text-strong">Remove</span>
                    .
                  </li>
                </ul>
              </div>

              {/* The consent gate is the load-bearing element of the
                  whole flow (ADR 2026-05-11). Migrated from a raw
                  <input type="checkbox"> to the design-system Checkbox
                  primitive on 2026-05-14 so it picks up the standard
                  focus ring + AAA hover-state border instead of the
                  browser default (which on bg-sunken was barely
                  visible). */}
              <div className="rounded border border-line bg-sunken p-3">
                <Checkbox
                  id={consentId}
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  required
                  requiredMark
                  label={
                    <>
                      Share this check with ContentRX and consent to its
                      use for check improvement.
                    </>
                  }
                />
              </div>

              {errorMessage && (
                <p className="text-sm text-accent-concern-text">
                  {errorMessage}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised"
                >
                  Cancel
                </button>
                <Button type="submit" size="sm" disabled={!canSubmit}>
                  {status === "submitting" ? "Sharing…" : "Share this check"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
