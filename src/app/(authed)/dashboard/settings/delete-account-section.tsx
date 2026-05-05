"use client";

/**
 * Account deletion flow for /dashboard/settings.
 *
 * Two-step disclosure: collapsed shows a single "Delete my account"
 * button; expanded shows the consequences inline plus a typed-confirm
 * input ("Type DELETE to confirm") and the destructive button.
 *
 * On submit: POST /api/dashboard/delete-account with the confirmation
 * string. On success, the server has already cancelled Stripe,
 * pseudonymized the user row + dependent rows, and deleted the Clerk
 * user. We sign the browser out via Clerk and redirect to /.
 *
 * Voice: matches the rest of the page. Calm, no theatrics, no
 * "Are you sure?" framing. The action is named directly; the bullet
 * list states what happens; the confirmation requires deliberate
 * typing rather than a single click.
 */

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

const REQUIRED_CONFIRMATION = "DELETE";

export function DeleteAccountSection() {
  const router = useRouter();
  const clerk = useClerk();
  const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    confirmation === REQUIRED_CONFIRMATION && !submitting;

  async function onSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/delete-account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "We couldn't complete the deletion. Try again.");
        setSubmitting(false);
        return;
      }
      // Server has pseudonymized the row and deleted the Clerk user.
      // Sign out clears the browser session and redirects.
      await clerk.signOut({ redirectUrl: "/" });
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error. Try again.",
      );
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center rounded-md border border-accent-concern-border bg-accent-concern-soft px-3 py-1.5 text-xs font-medium text-accent-concern-text hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Delete my account
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-accent-concern-border bg-accent-concern-soft p-4">
      <p className="text-sm font-semibold text-accent-concern-text">
        Delete account
      </p>
      <p className="mt-2 text-sm text-default">
        This runs the same pseudonymization the privacy policy commits
        to, immediately rather than after the 90-day grace period.
        It can&apos;t be undone.
      </p>
      <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-default">
        <li>
          Any active subscription is cancelled. Your card stops being
          charged.
        </li>
        <li>
          Team rules, custom examples, team members, and team
          invitations are deleted.
        </li>
        <li>
          Historical violation hashes and override records have your
          user id set to null. The hashed text and verdicts stay
          anonymized in our calibration corpus.
        </li>
        <li>
          Your email, API key, and Stripe customer link are cleared
          from your account row.
        </li>
        <li>
          Your Clerk login is deleted. You&apos;ll need to sign up
          again to use ContentRX.
        </li>
      </ul>
      <div className="mt-4">
        <label
          htmlFor="delete-confirm"
          className="block text-xs font-medium text-default"
        >
          Type <code className="font-mono">{REQUIRED_CONFIRMATION}</code>{" "}
          to confirm
        </label>
        <input
          id="delete-confirm"
          type="text"
          autoComplete="off"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={submitting}
          className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        />
      </div>
      {error && (
        <p className="mt-3 text-xs text-accent-concern-text">{error}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setConfirmation("");
            setError(null);
          }}
          disabled={submitting}
          className="inline-flex items-center rounded-md border border-line bg-raised px-3 py-1.5 text-xs font-medium text-default hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="inline-flex items-center rounded-md bg-accent-concern-solid px-3 py-1.5 text-xs font-medium text-accent-concern-on hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Deleting…" : "Delete account permanently"}
        </button>
      </div>
    </div>
  );
}
