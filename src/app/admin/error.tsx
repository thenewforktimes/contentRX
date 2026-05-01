"use client";

/**
 * Route-level error boundary for /admin/*.
 *
 * Diagnostic — surfaces the actual error message + digest on the page
 * so the founder can read what went wrong without paging through
 * Vercel logs. Founder-only by way of the parent layout's auth gate
 * (this component is only ever rendered after auth has passed).
 */

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

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
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
      <h1 className="text-lg font-semibold text-red-900 dark:text-red-200">
        /admin failed to render
      </h1>
      <p className="mt-2 text-sm text-red-800 dark:text-red-300">
        Diagnostic dump (founder-only — this surface is gated by the
        parent layout&apos;s admin check).
      </p>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-mono text-xs uppercase tracking-wide text-red-700 dark:text-red-400">
            message
          </dt>
          <dd className="mt-1 whitespace-pre-wrap break-words rounded bg-white/60 p-2 font-mono text-xs text-red-900 dark:bg-black/30 dark:text-red-200">
            {error.message || "(empty error message)"}
          </dd>
        </div>
        {error.digest && (
          <div>
            <dt className="font-mono text-xs uppercase tracking-wide text-red-700 dark:text-red-400">
              digest
            </dt>
            <dd className="mt-1 font-mono text-xs text-red-900 dark:text-red-200">
              {error.digest}
            </dd>
          </div>
        )}
        {error.stack && (
          <div>
            <dt className="font-mono text-xs uppercase tracking-wide text-red-700 dark:text-red-400">
              stack
            </dt>
            <dd className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white/60 p-2 font-mono text-[11px] text-red-900 dark:bg-black/30 dark:text-red-200">
              {error.stack}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-6 flex gap-3 text-sm">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-red-900 px-3 py-1.5 font-medium text-white hover:bg-red-800 dark:bg-red-200 dark:text-red-950 dark:hover:bg-red-100"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-red-300 px-3 py-1.5 font-medium text-red-900 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
