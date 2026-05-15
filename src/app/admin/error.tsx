"use client";

/**
 * Route-segment error boundary for `/admin/*`.
 *
 * Catches uncaught throws from any admin server component before they
 * cascade to `global-error.tsx`. The admin tree's loaders read from
 * a mix of local files (cost rollups, calibration JSON, refinement
 * markdown) and the Drizzle/Postgres data layer — most file-read
 * loaders are defensive at source, but DB hiccups, parse failures,
 * or a missing dev fixture still land here.
 *
 * Sentry captures the error so it surfaces in alerts rather than
 * relying on Robert noticing the page is blank. The `reset` callback
 * re-renders the segment without a full reload — usually enough for
 * transient DB issues; the back-to-/admin link gives a deterministic
 * recovery path when reset doesn't.
 *
 * Voice + chrome match the customer dashboard's `error.tsx`. Renders
 * as a section (not a `<main>`) because the admin layout already
 * provides the `<main id="main-content">` wrapper.
 */

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <section className="flex min-h-[60vh] max-w-2xl flex-col justify-center gap-4">
      <Eyebrow>500</Eyebrow>
      <h1 className="text-3xl font-semibold tracking-tight text-strong">
        Couldn&rsquo;t load this admin page
      </h1>
      <p className="text-base text-default">
        The error is logged. Try again, or jump back to today&rsquo;s
        queue. Most loaders read from local files (cost rollups,
        calibration snapshots, refinement logs) — a missing or
        transient read is the usual cause.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-quiet">ref: {error.digest}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className={buttonStyles({ size: "md" })}
        >
          Try again
        </button>
        <Link
          href="/admin"
          className={buttonStyles({ size: "md", variant: "secondary" })}
        >
          Today&rsquo;s queue
        </Link>
      </div>
    </section>
  );
}
