"use client";

/**
 * Route-segment error boundary for the authenticated dashboard.
 *
 * Catches any uncaught throw from a Server Component within /dashboard/*
 * before it cascades to `global-error.tsx`. The /dashboard tree fans
 * out to many loaders (current usage, subscription, team membership,
 * insight patterns, agent runs, source stats) — any one of those
 * failing transiently shouldn't black-screen the whole shell.
 *
 * Sentry captures the error so the underlying issue surfaces in alerts
 * rather than relying on the user to report it. The `reset` callback
 * re-renders the segment without a full page reload — usually enough
 * for transient DB hiccups.
 *
 * Voice matches `global-error.tsx` + `not-found.tsx`. The "Refresh"
 * affordance is paired with a sign-out link because some classes of
 * dashboard error (stale Clerk session, expired API key cookie)
 * resolve on re-auth; offering the option without forcing it lets the
 * customer choose.
 */

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";

export default function DashboardError({
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
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-6 py-20">
      <div className="flex flex-col gap-4">
        <Eyebrow>500</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight text-strong">
          Something on the dashboard didn&rsquo;t load
        </h1>
        <p className="text-base text-default">
          The error is logged. Refresh to retry. If it keeps happening,
          try signing back in to clear stale session state.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className={buttonStyles({ size: "md" })}
          >
            Try again
          </button>
          <Link
            href="/sign-in"
            className={buttonStyles({ size: "md", variant: "secondary" })}
          >
            Sign in again
          </Link>
        </div>
      </div>
    </main>
  );
}
