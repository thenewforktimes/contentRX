/**
 * /dashboard/cadence/quarterly — Quarterly taxonomy-review surface.
 *
 * Human-eval build plan Session 33. The load-bearing cadence:
 * reads the newest drift report from `evals/drift/reports/`
 * (Session 7 output), surfaces the measured ceiling + recalibrated
 * thresholds, and links to the quarterly review template + downstream
 * graduation decisions. Intentionally thin — orchestration, not a
 * new dashboard. The data comes from work the team already does via
 * `tools/drift_check.py` and `tools/graduation_metrics.py`.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "@/db";

interface DriftReport {
  schema_version?: string;
  quarter?: string;
  measured_ceiling?: number | null;
  kappa_summary?: {
    kappa?: number | null;
    ci_low?: number | null;
    ci_high?: number | null;
    n?: number;
  };
  thresholds?: {
    regime?: string;
    autonomous_kappa?: number;
    batch_approval_kappa?: number;
    blocks_new_autonomous?: boolean;
  };
  implicated_standards?: string[];
}

// Wrapped in unstable_cache so quarterly-review renders skip the FS
// read + JSON parse on every navigation. Drift reports are committed
// quarterly; a 24h revalidate is well within freshness budget. The
// cache layer JSON-serializes return values, so mtime is returned as
// an ISO string rather than Date — the consumer slices it directly.
const readLatestDriftReport = unstable_cache(
  async (): Promise<{
    report: DriftReport | null;
    filename: string | null;
    mtime_iso: string | null;
  }> => {
    const dir = path.join(process.cwd(), "evals", "drift", "reports");
    try {
      if (!fs.existsSync(dir)) {
        return { report: null, filename: null, mtime_iso: null };
      }
      const files = fs
        .readdirSync(dir)
        .filter((n) => n.endsWith(".json"))
        .sort()
        .reverse();
      if (files.length === 0) {
        return { report: null, filename: null, mtime_iso: null };
      }
      const filename = files[0]!;
      const p = path.join(dir, filename);
      const raw = fs.readFileSync(p, "utf-8");
      const mtime_iso = fs.statSync(p).mtime.toISOString();
      return { report: JSON.parse(raw) as DriftReport, filename, mtime_iso };
    } catch {
      return { report: null, filename: null, mtime_iso: null };
    }
  },
  ["dashboard-cadence-quarterly-drift"],
  { revalidate: 86400 },
);

export default async function QuarterlyReviewPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in?redirect_url=/dashboard/cadence/quarterly");

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user || user.plan !== "team" || user.teamOwnerUserId !== null) {
    redirect("/dashboard/cadence");
  }

  const { report, filename, mtime_iso } = await readLatestDriftReport();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Quarterly review · load-bearing
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Drift check + recalibration</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Every 13 weeks. Re-label the 80-case stratified panel (Session
          7), recompute the measured ceiling, recalibrate graduation
          thresholds via Session 10&apos;s ratio formula. Missing a
          quarter leaves thresholds out of calibration.
        </p>
      </header>

      {report ? (
        <ReportCard report={report} filename={filename} mtime_iso={mtime_iso} />
      ) : (
        <EmptyState />
      )}

      <section className="rounded-md border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="text-sm font-semibold">Cycle checklist</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
          <li>
            Build the panel:{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
              python3 tools/drift_check.py build-panel
            </code>
          </li>
          <li>Re-label the panel blind (via the review surface).</li>
          <li>
            Score:{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
              python3 tools/drift_check.py score
            </code>
            . The JSON lands in{" "}
            <code className="font-mono text-xs">evals/drift/reports/</code>.
          </li>
          <li>
            Run{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
              python3 tools/graduation_metrics.py
            </code>{" "}
            against the recalibrated thresholds. Promotions / demotions
            queue up on{" "}
            <Link className="underline underline-offset-2" href="/dashboard/graduation">
              /dashboard/graduation
            </Link>
            .
          </li>
          <li>
            Fill out{" "}
            <code className="font-mono text-xs">
              evals/cadence_templates/quarterly.md
            </code>{" "}
            and save to{" "}
            <code className="font-mono text-xs">
              evals/cadence_runs/quarterly/&lt;YYYY-Qn&gt;.md
            </code>
            .
          </li>
          <li>
            Commit + push. The overview hub picks up the new
            report + run marker.
          </li>
        </ol>
      </section>

      <section className="grid grid-cols-2 gap-4 text-sm">
        <Link
          href="/dashboard/cadence/calibration"
          className="rounded-lg border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
        >
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Monthly calibration view
          </p>
          <p className="mt-1 text-sm">Same source, read-only summary.</p>
        </Link>
        <Link
          href="/dashboard/cadence/annual"
          className="rounded-lg border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
        >
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Annual audit
          </p>
          <p className="mt-1 text-sm">Complement to this check, once a year.</p>
        </Link>
      </section>

      <Link
        href="/dashboard/cadence/overview"
        className="text-xs text-neutral-600 underline underline-offset-2 dark:text-neutral-400"
      >
        ← Back to cadence overview
      </Link>
    </div>
  );
}

function ReportCard({
  report,
  filename,
  mtime_iso,
}: {
  report: DriftReport;
  filename: string | null;
  mtime_iso: string | null;
}) {
  const k = report.kappa_summary?.kappa;
  const lo = report.kappa_summary?.ci_low;
  const hi = report.kappa_summary?.ci_high;
  const isBlocking = report.thresholds?.blocks_new_autonomous === true;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Latest drift report
          </p>
          <p className="mt-1 font-mono text-sm">
            {report.quarter ?? filename ?? "—"}
          </p>
        </div>
        {mtime_iso && (
          <p className="text-xs text-neutral-500">
            File mtime · {mtime_iso.slice(0, 10)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <Stat label="Measured κ" value={typeof k === "number" ? k.toFixed(3) : "—"} />
        <Stat
          label="95% CI"
          value={
            typeof lo === "number" && typeof hi === "number"
              ? `${lo.toFixed(3)} – ${hi.toFixed(3)}`
              : "—"
          }
        />
        <Stat
          label="Regime"
          value={report.thresholds?.regime ?? "unknown"}
          tone={isBlocking ? "warn" : "default"}
        />
      </div>

      {report.thresholds && (
        <div className="text-xs text-neutral-600 dark:text-neutral-400">
          Autonomous κ threshold:{" "}
          <span className="font-mono">
            {report.thresholds.autonomous_kappa?.toFixed(3)}
          </span>
          {" · "}
          Batch-approval κ threshold:{" "}
          <span className="font-mono">
            {report.thresholds.batch_approval_kappa?.toFixed(3)}
          </span>
        </div>
      )}

      {report.implicated_standards && report.implicated_standards.length > 0 && (
        <div>
          <p className="text-xs font-semibold">
            Standards triggering self-disagreement
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {report.implicated_standards.map((s) => (
              <span
                key={s}
                className="rounded-full border border-neutral-300 px-2 py-0.5 font-mono text-xs dark:border-neutral-700"
              >
                {s}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Triage each in the quarterly template&apos;s &ldquo;Standards
            triggering self-disagreement&rdquo; section. File a
            refinement-log entry when the divergence points to a
            fixable rule.
          </p>
        </div>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <section className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
      <p>
        No drift report yet. Run{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
          python3 tools/drift_check.py build-panel
        </code>{" "}
        locally, blind-relabel the panel, then{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
          drift_check.py score
        </code>
        . The report lands under{" "}
        <code className="font-mono text-xs">evals/drift/reports/</code>.
        Commit it to surface the measured ceiling here.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  const valueColor =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-300"
      : "text-neutral-900 dark:text-neutral-100";
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="text-xs uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}
