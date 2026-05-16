"use client";

/**
 * "MCP connected. You're ready for checks." (PR-32)
 *
 * The activation moment per the customer-journey diagrams: confirms
 * that the surface the user just installed is wired up correctly.
 * Server (loadSourceStats) picks the most recently activated surface
 * scoped to THIS user's own usage_events within the last 7 days; the
 * client decides whether to render from a per-user, per-source
 * localStorage dismissal flag.
 *
 * Localstorage key: `cx_first_call_dismissed_<source>_<clerkUserId>`.
 *   - Per source: a user who activates MCP, dismisses, then later
 *     activates the GitHub Action should still get the second
 *     confirmation.
 *   - Per user: on a shared browser profile, one user's dismissal
 *     must not suppress another user's first-call banner. The server
 *     scopes WHICH surface counts as recently-activated per user;
 *     this is the localStorage half of the same correctness property.
 */

import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

const DISMISS_PREFIX = "cx_first_call_dismissed_";

type SurfaceKey = "dashboard" | "mcp" | "lsp" | "action" | "cli";

const LABELS: Record<SurfaceKey, string> = {
  dashboard: "Web app",
  mcp: "MCP",
  lsp: "LSP",
  action: "GitHub Action",
  cli: "CLI",
};

function dismissKey(source: SurfaceKey, userId: string): string {
  return `${DISMISS_PREFIX}${source}_${userId}`;
}

export function FirstCallBanner({ source }: { source: SurfaceKey | null }) {
  const { user, isLoaded } = useUser();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    // Defer until Clerk resolves the user — the dismissal key is
    // per-user, so reading localStorage before the user id is known
    // would risk keying off the wrong (or a stale) user on a shared
    // browser profile.
    if (!source || !isLoaded || !user) return;
    try {
      const dismissed = window.localStorage.getItem(
        dismissKey(source, user.id),
      );
      if (!dismissed) setHidden(false);
    } catch {
      // localStorage blocked — render the banner as a fallback so the
      // user still sees the activation confirmation. Worst case: they
      // see it twice.
      setHidden(false);
    }
  }, [source, isLoaded, user]);

  if (!source || hidden || !user) return null;

  function dismiss() {
    if (!source || !user) return;
    try {
      window.localStorage.setItem(dismissKey(source, user.id), "1");
    } catch {
      // Ignore — we'll just show the banner again on next load. Not
      // worth surfacing an error for a polish UI.
    }
    setHidden(true);
  }

  const label = LABELS[source] ?? source;
  return (
    <section
      role="status"
      className="flex items-start justify-between gap-3 rounded-lg border border-accent-affirm-border bg-accent-affirm-soft px-4 py-3 text-sm"
    >
      <p className="text-accent-affirm-text">
        <span aria-hidden className="mr-1.5 font-semibold">
          ✓
        </span>
        <span className="font-medium">{label} connected.</span>{" "}
        You&apos;re ready for checks.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-md px-2 py-0.5 text-xs text-accent-affirm-text hover:bg-accent-affirm-border/20"
      >
        Dismiss
      </button>
    </section>
  );
}
