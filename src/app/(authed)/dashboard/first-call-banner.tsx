"use client";

/**
 * "MCP connected. You're ready for checks." (PR-32)
 *
 * The activation moment per the customer-journey diagrams: confirms
 * that the surface the user just installed is wired up correctly.
 * Server picks the most recently activated surface (first call within
 * the last 7 days); the client decides whether to render based on a
 * per-source localStorage dismissal flag.
 *
 * Localstorage key: `cx_first_call_dismissed_<source>`. Per source
 * because a user who activates MCP, dismisses, then later activates
 * the GitHub Action should still get the second confirmation.
 */

import { useEffect, useState } from "react";

const DISMISS_PREFIX = "cx_first_call_dismissed_";

type SurfaceKey = "mcp" | "lsp" | "action" | "plugin" | "cli";

const LABELS: Record<SurfaceKey, string> = {
  mcp: "MCP",
  lsp: "LSP",
  action: "GitHub Action",
  plugin: "Figma plugin",
  cli: "CLI",
};

export function FirstCallBanner({ source }: { source: SurfaceKey | null }) {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!source) return;
    try {
      const key = DISMISS_PREFIX + source;
      const dismissed = window.localStorage.getItem(key);
      if (!dismissed) setHidden(false);
    } catch {
      // localStorage blocked — render the banner as a fallback so the
      // user still sees the activation confirmation. Worst case: they
      // see it twice.
      setHidden(false);
    }
  }, [source]);

  if (!source || hidden) return null;

  function dismiss() {
    if (!source) return;
    try {
      window.localStorage.setItem(DISMISS_PREFIX + source, "1");
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
      className="flex items-start justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950"
    >
      <p className="text-emerald-900 dark:text-emerald-200">
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
        className="shrink-0 rounded-md px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
      >
        Dismiss
      </button>
    </section>
  );
}
