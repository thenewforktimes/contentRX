"use client";

/**
 * FindingMakeRuleModal — the customer's path for turning a
 * disagreement with a finding into a durable team-level rule.
 *
 * Block 1d of the calibration plan. Implements the Make-a-rule modal
 * specified in ADR 2026-04-29 §3+§4: pre-filled with the finding's
 * input string + issue context, writes a `team_custom_examples` row
 * with `verdict = "pass"` so the team's future checks short-circuit
 * past this exact string. Optional `contribute_upstream` checkbox
 * (default OFF) for the team to feed the example back to the
 * substrate calibration loop.
 *
 * Why team_custom_examples and not team_rules: the customer's intent
 * is "stop flagging this exact string for my team," which is an
 * exact-match exception. team_rules is the heavier intervention
 * (disable the standard, override its rule text) — too aggressive
 * for one finding. The custom-example path is the precise
 * intervention that matches the user's actual disagreement.
 *
 * Free/Pro: this modal is gated to Team plan in the explain client;
 * Free/Pro users see the upsell affordance (a button styled link to
 * /pricing#team) and never reach the modal. The modal still respects
 * the gate defensively — if it ever opens on a non-Team plan, the
 * server route returns 403 and the modal surfaces it gracefully.
 */

import { useEffect, useState } from "react";
import { buttonStyles } from "@/components/ui/button";
import type { Plan } from "@/lib/quotas";

export interface FindingMakeRuleModalProps {
  open: boolean;
  onClose: () => void;
  /** The text the customer was checking — pre-fills the rule. */
  submittedText: string;
  /** The public-envelope issue text — pre-fills the notes field. */
  issue: string;
  /** Customer's plan. The modal still renders on Free/Pro for
   *  defensive consistency, but server-side gating returns 403
   *  and we surface the upgrade message. */
  plan: Plan;
  onSaved: () => void;
}

type SubmitState = "idle" | "submitting" | "error";

export function FindingMakeRuleModal({
  open,
  onClose,
  submittedText,
  issue,
  plan,
  onSaved,
}: FindingMakeRuleModalProps) {
  const [text, setText] = useState(submittedText);
  const [notes, setNotes] = useState(issue);
  const [contributeUpstream, setContributeUpstream] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText(submittedText);
    setNotes(issue);
    setContributeUpstream(false);
    setSubmitState("idle");
    setErrorMessage(null);
  }, [open, submittedText, issue]);

  if (!open) return null;

  const onSubmit = async () => {
    setSubmitState("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/team-custom-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          // The whole point of the rule from a Make-a-rule flow:
          // pin THIS exact string as a pass for the team. Future
          // /api/check calls on the same normalized text short-
          // circuit past the LLM and return a pass.
          verdict: "pass",
          notes: notes.trim() || undefined,
          contribute_upstream: contributeUpstream,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          typeof (data as { error?: unknown })?.error === "string"
            ? (data as { error: string }).error
            : "Couldn't save rule. Try again.";
        setErrorMessage(msg);
        setSubmitState("error");
        return;
      }
      onSaved();
    } catch {
      setErrorMessage("Couldn't reach the server. Check your connection.");
      setSubmitState("error");
    }
  };

  const canSubmit =
    submitState !== "submitting" && text.trim().length > 0 && plan === "team";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Make a rule for your team"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-stone-200 bg-white shadow-xl dark:border-stone-800 dark:bg-stone-950">
        <header className="border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            Make a rule for your team
          </h2>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Pin this exact string as a pass. Future checks for your
            team won&apos;t flag it.
          </p>
        </header>

        <div className="space-y-4 px-5 py-5">
          {plan !== "team" && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Custom rules are available on the Team plan. This action
              won&apos;t save until your team upgrades.
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
              The string
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={100_000}
              className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              Match is case-insensitive. Whitespace gets normalized
              before lookup.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
              Why this should pass{" "}
              <span className="font-normal text-stone-500 dark:text-stone-400">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Visible to your team when this rule fires."
              className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </div>

          <section className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/50">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={contributeUpstream}
                onChange={(e) => setContributeUpstream(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 dark:border-stone-700"
              />
              <span className="flex-1">
                <span className="font-medium text-stone-900 dark:text-stone-100">
                  Help calibrate the ContentRX model
                </span>
                <span className="mt-0.5 block text-stone-600 dark:text-stone-400">
                  Your rule becomes a candidate for review. Only
                  approved suggestions reach the model. Off by
                  default.
                </span>
              </span>
            </label>
          </section>

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
            {submitState === "submitting" ? "Saving…" : "Save rule"}
          </button>
        </footer>
      </div>
    </div>
  );
}
