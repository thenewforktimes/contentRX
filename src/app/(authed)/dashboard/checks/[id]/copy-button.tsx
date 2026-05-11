"use client";

/**
 * Small "Copy" affordance used on the check detail page next to any
 * block of text the customer might want to lift (full input,
 * suggested rewrite, individual suggestion). Stays minimal — no toast
 * library, no portal, just inline state that flips for 1.6s after a
 * successful copy so the customer sees confirmation in place.
 *
 * Falls back silently to a no-op when `navigator.clipboard` is
 * unavailable (older browsers, insecure origins, iframes without
 * permission). The button is still rendered so layout doesn't shift;
 * the lack of confirmation is the only signal — acceptable since
 * /dashboard/checks/[id] is gated behind Clerk auth and runs on
 * https in every supported environment.
 */

import { useState } from "react";

export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard write rejected (permissions, focus loss). Stay silent
      // — the customer will retry; we don't surface a console error.
    }
  }

  const base =
    "shrink-0 rounded-md border border-line bg-raised px-2.5 py-1 text-xs font-medium text-default transition-colors hover:bg-hover";
  return (
    <button
      type="button"
      onClick={onClick}
      className={[base, className].filter(Boolean).join(" ")}
      aria-label={label}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
