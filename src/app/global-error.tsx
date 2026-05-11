"use client";

/**
 * Top-level error boundary. Captures any error that escapes a route
 * segment's own error.tsx so Sentry sees crashes the user-facing UI
 * couldn't handle.
 */

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <main className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-xl font-semibold">Something went wrong.</h1>
            <p className="text-sm text-neutral-600">
              We&apos;ve been notified. Refresh the page or head back to{" "}
              <Link href="/" className="underline">
                the homepage
              </Link>
              .
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
