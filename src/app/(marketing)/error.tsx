"use client";

/**
 * Route-segment error boundary for the marketing routes.
 *
 * Catches any uncaught throw from a Server Component within /, /writes,
 * /accuracy, /privacy, /terms, /disclaimer, /ethics, /pricing, /install,
 * /security, /waitlist before it cascades to `global-error.tsx`. Without
 * a per-segment boundary, every transient failure in (for example) the
 * /disclaimer Termageddon SSR fetch would tear down the root layout and
 * land the visitor on the unstyled global-error.tsx — bad first
 * impression, especially for an SEO-traffic-heavy surface.
 *
 * Renders the calm "we logged it" UI inline with the marketing chrome
 * (header, footer) preserved. Captures to Sentry so Robert sees the
 * underlying issue without depending on browser logs.
 *
 * Voice matches `global-error.tsx` and `not-found.tsx`: calm + specific,
 * no apology, no catastrophizing, names what happened, points somewhere
 * productive.
 */

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";

export default function MarketingError({
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
          This page didn&rsquo;t load cleanly
        </h1>
        <p className="text-base text-default">
          The error is already logged. Refresh first. If that doesn&rsquo;t
          help, head somewhere else.
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
            href="/"
            className={buttonStyles({ size: "md", variant: "secondary" })}
          >
            ContentRX home
          </Link>
        </div>
      </div>
    </main>
  );
}
