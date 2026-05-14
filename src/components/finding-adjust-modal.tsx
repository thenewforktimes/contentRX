"use client";

/**
 * FindingAdjustModal — the customer's path for telling ContentRX
 * "you got this wrong" on a check finding.
 *
 * Per ADR 2026-05-11, Adjust is a private record of the customer's
 * own dismissal. The string and the disagreement land in
 * `violation_overrides` (sha256 only). Nothing flows into the
 * calibration log from here.
 *
 * To share a string with ContentRX for calibration, the customer
 * uses the separate Flag-for-Review CTA + consent modal
 * (src/components/flag-for-review.tsx). That is the only path.
 *
 * Substrate boundary (ADR 2026-04-25): this component sees only
 * public-envelope fields. The server route correlates against the
 * violations table to recover (moment, content_type, standard_id)
 * for substrate-side storage.
 */

import { useEffect, useId, useRef, useState } from "react";
import { buttonStyles } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/input";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import {
  OVERRIDE_REASON_META,
  type OverrideReasonCode,
} from "@/lib/override-reasons";

// The 3 verdict-disagreement codes shown in the Adjust modal. The
// other two from override-reasons.ts (`fix_is_worse`,
// `shipping_anyway`) belong to different flows.
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
  /** The public-envelope issue text — passed through for clustering. */
  issue: string;
  /** Called after a successful save with the response payload. */
  onSaved: (saved: { verdictRecorded: boolean }) => void;
}

type SubmitState = "idle" | "submitting" | "error";

export function FindingAdjustModal({
  open,
  onClose,
  submittedText,
  issue,
  onSaved,
}: FindingAdjustModalProps) {
  const reasonId = useId();
  const notesId = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonSelectRef = useRef<HTMLSelectElement>(null);

  const [reasonCode, setReasonCode] = useState<OverrideReasonCode>(
    "not_applicable_here",
  );
  const [notes, setNotes] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReasonCode("not_applicable_here");
    setNotes("");
    setSubmitState("idle");
    setErrorMessage(null);
  }, [open]);

  // Focus management: trap focus inside the dialog, ESC closes,
  // background goes `inert`, focus restored to trigger on close.
  // Initial focus lands on the reason select (the first decision
  // the user has to make).
  useFocusTrap({
    active: open,
    containerRef: dialogRef,
    onClose,
    initialFocusRef: reasonSelectRef,
  });

  if (!open) return null;

  const canSubmit = submitState !== "submitting";

  const onSubmit = async () => {
    setSubmitState("submitting");
    setErrorMessage(null);

    const body: Record<string, unknown> = {
      text: submittedText,
      signal_type: "verdict",
      issue,
      override_reason_code: reasonCode,
    };
    if (notes.trim()) body.override_notes = notes.trim();

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
        recorded?: { verdict?: boolean };
      };
      onSaved({ verdictRecorded: Boolean(data.recorded?.verdict) });
    } catch {
      setErrorMessage("Couldn't reach the server. Check your connection.");
      setSubmitState("error");
    }
  };

  return (
    <div
      // bg-overlay was a SOLID surface color — it completely obscured
      // the page below the dialog. Replaced with bg-black/40
      // (translucent black scrim) to match flag-for-review.tsx and
      // admin/command-palette.tsx. Low-vision users now retain the
      // spatial sense of "modal floating over content" instead of
      // "the page disappeared." 2026-05-14 audit fix.
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-line bg-raised shadow-xl">
        <header className="border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-strong">
            Adjust the verdict
          </h2>
          <p className="mt-1 text-sm text-default">
            Record that this finding doesn&apos;t apply to your team&apos;s
            context. ContentRX stores a hash of the check for your
            private dashboard. Nothing here is shared. To share the
            check for calibration, use Flag for Review on the finding.
          </p>
        </header>

        <div className="space-y-4 px-5 py-5">
          {/* Reason + Notes migrated to design-system primitives on
              2026-05-14. Pre-migration this modal used raw <select>
              and <textarea> with no focus-visible ring and no
              min-h-[44px] touch target — keyboard users inside the
              focus-trapped dialog got only the browser default focus
              outline (which doesn't track --ring-focus). WCAG 2.4.7 +
              2.5.5. */}
          <div>
            <Label htmlFor={reasonId} className="text-xs">
              Reason
            </Label>
            <Select
              ref={reasonSelectRef}
              id={reasonId}
              value={reasonCode}
              onChange={(e) =>
                setReasonCode(e.target.value as OverrideReasonCode)
              }
              helperText={OVERRIDE_REASON_META[reasonCode].description}
              className="mt-1"
            >
              {VERDICT_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {OVERRIDE_REASON_META[code].label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={notesId} className="text-xs">
              Notes <span className="font-normal text-quiet">(optional)</span>
            </Label>
            <Textarea
              id={notesId}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Anything else worth recording for yourself?"
              className="mt-1"
            />
          </div>

          {errorMessage && (
            <p
              role="alert"
              className="rounded-md border border-accent-caution-border bg-accent-caution-soft px-3 py-2 text-sm text-accent-caution-text"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
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
