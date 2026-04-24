/**
 * /dashboard/cadence/calibration — Monthly calibration summary.
 *
 * Human-eval build plan Session 9. Reads the latest drift report from
 * `evals/drift/reports/` (when available) and shows the measured
 * ceiling + 95% CI + threshold regime. The page is mostly a pointer:
 * the actual panel-building and scoring happens via
 * `tools/drift_check.py` locally (Session 7).
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { MOMENT_ROTATION } from "@/lib/cadence";
import fs from "node:fs";
import path from "node:path";

interface DriftReport {
  schema_version?: string;
  quarter?: string;
  measured_ceiling?: number | null;
  kappa_summary?: {
    kappa?: number | null;
    ci_low?: number | null;
    ci_high?: number | null;
    n?: number;
    observed_agreement?: number | null;
  };
  thresholds?: {
    regime?: string;
    autonomous_kappa?: number;
    batch_approval_kappa?: number;
    blocks_new_autonomous?: boolean;
  };
  disagreements?: unknown[];
  implicated_standards?: string[];
}

function readLatestDriftReport(): DriftReport | null {
  const dir = path.join(process.cwd(), "evals", "drift", "reports");
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    const raw = fs.readFileSync(path.join(dir, files[0]!), "utf-8");
    return JSON.parse(raw) as DriftReport;
  } catch {
    return null;
  }
}

export default async function CalibrationPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/cadence/calibration");
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user || user.plan !== "team" || user.teamOwnerUserId !== null) {
    redirect("/dashboard/cadence");
  }

  const report = readLatestDriftReport();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Monthly calibration
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Self-drift</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Quarterly re-label of an 80-case stratified panel. The measured
          κ against past-self is the graduation ladder&apos;s calibration
          anchor (Session 10 consumes this).
        </p>
      </header>

      {report ? (
        <DriftReportCard report={report} />
      ) : (
        <section className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
          <p>
            No drift report yet. Run{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
              python3 tools/drift_check.py build-panel
            </code>{" "}
            locally from a checkout with the private corpus, re-label
            the panel blind, then run{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
              drift_check.py score
            </code>
            . The report lands under{" "}
            <code className="font-mono text-xs">evals/drift/reports/</code>
            ; committing it surfaces the measured ceiling here.
          </p>
          <p className="mt-3">
            Full workflow:{" "}
            <code className="font-mono text-xs">evals/drift/README.md</code>
            .
          </p>
        </section>
      )}

      <section className="rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <h2 className="text-sm font-semibold">Moment rotation</h2>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          Each of the {MOMENT_ROTATION.length} moments surfaces for deep-review
          once every {MOMENT_ROTATION.length} weeks. See the weekly schedule
          below. The rotation derives from ISO week number (+ year offset)
          so it&apos;s stable across rebuilds.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {MOMENT_ROTATION.map((m) => (
            <Link
              key={m}
              href={`/dashboard/cadence/moment/${m}`}
              className="rounded-full border border-neutral-300 px-2 py-1 font-mono text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {m}
            </Link>
          ))}
        </div>
      </section>

      <Link
        href="/dashboard/cadence"
        className="text-xs text-neutral-600 underline underline-offset-2 dark:text-neutral-400"
      >
        ← Back to daily queue
      </Link>
    </div>
  );
}

function DriftReportCard({ report }: { report: DriftReport }) {
  const k = report.kappa_summary?.kappa;
  const lo = report.kappa_summary?.ci_low;
  const hi = report.kappa_summary?.ci_high;
  const regime = report.thresholds?.regime ?? "unknown";
  const isBlocking = report.thresholds?.blocks_new_autonomous === true;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
      <div>
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Latest quarter
        </p>
        <p className="mt-1 font-mono text-sm">{report.quarter ?? "—"}</p>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <Stat
          label="Measured κ"
          value={typeof k === "number" ? k.toFixed(3) : "—"}
        />
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
          value={regime}
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
          <p className="text-xs font-semibold">Standards flagged for refinement-log review</p>
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
        </div>
      )}
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
      <p className={`mt-1 font-mono text-lg font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}
