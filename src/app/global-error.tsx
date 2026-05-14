"use client";

/**
 * Top-level error boundary. Captures any error that escapes a route
 * segment's own error.tsx so Sentry sees crashes the user-facing UI
 * couldn't handle.
 *
 * v2 (2026-05-13): polished in place to match the not-found.tsx
 * design language. Same Wordmark-in-a-header chrome, same eyebrow +
 * heading + body + button-group pattern, same two CTAs (ContentRX
 * home + Open dashboard). The two error states now feel like one
 * family — customers landing on either 404 or 500 see the same
 * brand shape and the same paths forward.
 *
 * Constraints unique to global-error.tsx:
 *   - Must be a Client Component ("use client") per Next.js
 *   - Renders its own <html> and <body> tags because it replaces
 *     the root layout when it fires
 *   - Globals.css is imported here so design tokens (bg-canvas,
 *     text-strong, etc.) resolve even though the root layout
 *     didn't run
 *   - font-family is set inline on <body> because the root layout's
 *     Inter variable (next/font/google) doesn't propagate into a
 *     bypass-layout error page; falling back to a system Inter +
 *     system-sans stack keeps the typography close to the rest of
 *     the site
 *   - No Clerk auth hooks. Hitting useUser() inside an error
 *     boundary can itself throw if auth is part of what crashed.
 *     The "Open dashboard" CTA lets Clerk middleware handle the
 *     logged-in/logged-out split naturally — no detection here.
 *
 * Voice: matches not-found.tsx. Calm + specific. Doesn't apologize
 * (per docs/copy-vocabulary.md), doesn't catastrophize, no
 * first-person, names what happened, points somewhere productive.
 */

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Wordmark } from "@/components/wordmark";
import "./globals.css";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div className="flex min-h-screen flex-col bg-canvas">
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-3xl items-center px-6 py-5">
              <Wordmark size="sm" />
            </div>
          </header>
          <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
            <div className="flex flex-col gap-4">
              <Eyebrow>500</Eyebrow>
              <h1 className="text-3xl font-semibold tracking-tight text-strong">
                Something broke on this page
              </h1>
              <p className="text-base text-default">
                The error is already logged. Refresh the page first.
                If that doesn&rsquo;t help, head somewhere else.
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <Link href="/" className={buttonStyles({ size: "md" })}>
                  ContentRX home
                </Link>
                <Link
                  href="/dashboard"
                  className={buttonStyles({
                    size: "md",
                    variant: "secondary",
                  })}
                >
                  Open dashboard
                </Link>
              </div>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
