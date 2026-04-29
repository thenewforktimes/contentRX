/**
 * /status — public health page.
 *
 * Renders the same shape as /api/status, but human-readable. A
 * customer who sees a 5xx on /api/check can come here, see "DB
 * degraded" with a latency number, and know it's us not them.
 *
 * Server component — runs the probes inline on every request, no
 * client JS, no caching. Auto-revalidate on every page load. If
 * traffic ever justifies it, swap to a 30s ISR or a cron-fed
 * Redis snapshot; pre-launch this is fine.
 */

import type { Metadata } from "next";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  type CheckResult,
  gatherStatus,
} from "@/lib/status-checks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status. ContentRX",
  description:
    "Live health for ContentRX's database and rate-limit infrastructure. Public, machine-readable JSON also at /api/status.",
};

export default async function StatusPage() {
  const report = await gatherStatus();
  const checkedAt = new Date(report.generatedAt);

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <header className="mb-10">
        <Eyebrow>Status</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold">
          {report.ok ? "All systems operational" : "Degraded"}
        </h1>
        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
          Last checked{" "}
          <time dateTime={report.generatedAt}>
            {checkedAt.toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "long",
            })}
          </time>
          . Each load re-runs the probes. JSON at{" "}
          <a
            href="/api/status"
            className="underline underline-offset-2"
          >
            /api/status
          </a>
          .
        </p>
      </header>

      <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        <CheckRow label="Database" check={report.checks.db} />
        <CheckRow label="Rate limit / cache" check={report.checks.redis} />
      </ul>

      <section className="mt-10 rounded-lg border border-stone-200 p-5 text-sm dark:border-stone-800">
        <h2 className="text-sm font-semibold">What this page covers</h2>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          Database and Redis are the two pieces a slow page would point
          at first. The Anthropic-backed evaluation engine is health-
          checked implicitly. If <code>/api/check</code> returns
          verdicts at all, the engine is reachable. For incident
          history beyond live status, watch{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/issues"
            className="underline underline-offset-2"
          >
            the issue tracker
          </a>
          .
        </p>
      </section>
    </main>
  );
}

function CheckRow({ label, check }: { label: string; check: CheckResult }) {
  return (
    <li className="flex items-center justify-between py-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={
            check.ok
              ? "inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"
              : "inline-block h-2.5 w-2.5 rounded-full bg-red-500"
          }
        />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-3 text-right">
        <span className="text-xs tabular-nums text-stone-500 dark:text-stone-400">
          {check.latencyMs} ms
        </span>
        <span
          className={
            check.ok
              ? "text-sm text-emerald-700 dark:text-emerald-400"
              : "text-sm text-red-700 dark:text-red-400"
          }
        >
          {check.ok ? "Operational" : "Degraded"}
        </span>
      </div>
    </li>
  );
}
