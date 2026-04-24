/**
 * /dashboard/explain — interactive "Why this verdict?" demo.
 *
 * Human-eval build plan Session 21. The rationale-chain component
 * lives in `src/components/rationale-chain.tsx`; this page is the
 * minimum viable surface for it on the web app. Users paste a string,
 * hit Check, and see the three-state verdict + expandable rationale
 * tree with a one-click feedback path for misdetected moments.
 *
 * Clerk-gated, counts against monthly quota (POSTs to /api/check).
 * The misdetection-feedback POST also goes through Clerk session auth.
 */

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExplainClient } from "./explain-client";

export const metadata = {
  title: "Explain a verdict — ContentRX",
};

export default async function ExplainPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/dashboard/explain");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Session 21 — rationale chain
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Explain a verdict</h1>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          Paste a button label, error message, or paragraph. The
          evaluator returns a three-state verdict plus the full
          rationale chain — moment detected, standards applied,
          confidence at every hop. Misdetections route back to the
          review queue with one click.
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          Each check counts against your{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            monthly quota
          </Link>
          .
        </p>
      </header>

      <ExplainClient />
    </main>
  );
}
