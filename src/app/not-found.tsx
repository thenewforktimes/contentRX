/**
 * Global 404 — Next.js App Router convention.
 *
 * Without this file, Vercel renders a generic platform 404 with no
 * brand chrome. With it, customers who hit a stale link or mistyped
 * URL land on a ContentRX-shaped page that points them somewhere
 * useful.
 *
 * Lives at /src/app/not-found.tsx (not inside a route group), so it
 * applies to every route that doesn't match — marketing, dashboard,
 * /admin alike. Each route group can ship its own narrower
 * not-found.tsx if a more specific empty-state copy is wanted; this
 * is the catch-all.
 *
 * Voice: calm + specific (per docs/copy-vocabulary.md). Doesn't
 * apologize, doesn't catastrophize. Names what happened, points
 * somewhere productive.
 */

import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Wordmark } from "@/components/wordmark";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center px-6 py-5">
          <Wordmark size="sm" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
        <div className="flex flex-col gap-4">
          <Eyebrow>404</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight text-strong">
            That page isn&apos;t here.
          </h1>
          <p className="text-base text-default">
            The link may be stale, or the page may have moved. Most of
            ContentRX is reachable from the homepage or your dashboard.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href="/" className={buttonStyles({ size: "md" })}>
              ContentRX home
            </Link>
            <Link
              href="/dashboard"
              className={buttonStyles({ size: "md", variant: "secondary" })}
            >
              Open dashboard
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
