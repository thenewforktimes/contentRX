/**
 * /dashboard/explain — interactive "Why this verdict?" demo.
 *
 * Users paste a string, hit Check, and see the schema 2.0.0 public
 * envelope: a verdict pill + violations with `issue`, `suggestion`,
 * `severity`, `confidence`. Substrate fields (rationale chain, moments,
 * standard ids) are stripped at the API boundary per ADR 2026-04-25
 * and never reach this surface.
 *
 * Clerk-gated, counts against monthly quota (POSTs to /api/check).
 * The misdetection-feedback POST also goes through Clerk session auth.
 */

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExplainClient } from "./explain-client";

export const metadata = {
  title: "Explain a verdict. ContentRX",
};

export default async function ExplainPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/dashboard/explain");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
          Live demo
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Explain a verdict</h1>
        <p className="mt-3 text-sm text-default">
          Paste a button label, error message, or paragraph. The
          evaluator surfaces the detected moment first, then returns a
          three-state verdict plus the full rationale chain: moment
          detected, standards applied, confidence at every hop.
          Misdetections route back to the review queue with one click.
        </p>
        <p className="mt-3 text-xs text-quiet">
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
