/**
 * /dashboard/cadence/annual — Annual taxonomy-audit surface.
 *
 * Human-eval build plan Session 33. Orchestration for the
 * Session 36 annual audit: reads the newest report out of
 * `evals/annual_audit/reports/`, surfaces the audit band + design-
 * target ceiling recommendation, and links to the template. Runs
 * once per year — the surface exists primarily as a reminder + a
 * landing page for the most recent audit.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "@/db";

interface AnnualReport {
  schema_version?: string;
  year?: number;
  sample_size?: number;
  agreement_rate?: number | null;
  audit_band?: "stable" | "watch" | "material_drift" | string;
  design_target_recommendation?: {
    recommendation?: string;
    rationale?: string;
  };
  implicated_standards?: string[];
  new_moment_candidates?: string[];
  retired_reinstatement_candidates?: string[];
}

// Wrapped in unstable_cache so annual-audit renders skip the FS read
// + JSON parse on every navigation. Reports are committed annually;
// 24h revalidate is well within freshness budget. Returns mtime as
// ISO string because the cache layer JSON-serializes return values
// (Date round-trips through string).
const readLatestReport = unstable_cache(
  async (): Promise<{
    report: AnnualReport | null;
    filename: string | null;
    mtime_iso: string | null;
  }> => {
    const dir = path.join(process.cwd(), "evals", "annual_audit", "reports");
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
      return { report: JSON.parse(raw) as AnnualReport, filename, mtime_iso };
    } catch {
      return { report: null, filename: null, mtime_iso: null };
    }
  },
  ["dashboard-cadence-annual-report"],
  { revalidate: 86400 },
);

export default async function AnnualAuditPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in?redirect_url=/dashboard/cadence/annual");

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user || user.plan !== "team" || user.teamOwnerUserId !== null) {
    redirect("/dashboard/cadence");
  }

  const { report, filename, mtime_iso } = await readLatestReport();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Annual audit · once a year
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Full corpus taxonomy audit</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Complements the quarterly drift check. Re-labels a random
          100-case sample older than a year under the current schema.
          Surfaces long-term drift and overfitting that the quarterly
          cadence wouldn&apos;t catch.
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
              python3 tools/annual_audit_sample.py build-panel
            </code>
          </li>
          <li>Blind re-label under the current schema.</li>
          <li>
            Score:{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
              python3 tools/annual_audit_score.py
            </code>
            . JSON + Markdown reports land in{" "}
            <code className="font-mono text-xs">
              evals/annual_audit/reports/
            </code>
            .
          </li>
          <li>
            Fill out{" "}
            <code className="font-mono text-xs">
              evals/cadence_templates/annual.md
            </code>
            , save to{" "}
            <code className="font-mono text-xs">
              evals/cadence_runs/annual/&lt;YYYY&gt;.md
            </code>
            .
          </li>
          <li>
            Decide whether the 0.90 design-target ceiling still holds;
            if the recommendation changes, update the constant + the
            /accuracy page copy.
          </li>
        </ol>
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
  report: AnnualReport;
  filename: string | null;
  mtime_iso: string | null;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Latest audit
          </p>
          <p className="mt-1 font-mono text-sm">
            {report.year ?? filename ?? "—"}
          </p>
        </div>
        {mtime_iso && (
          <p className="text-xs text-neutral-500">
            File mtime · {mtime_iso.slice(0, 10)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <Stat label="Sample size" value={(report.sample_size ?? 0).toString()} />
        <Stat
          label="Agreement rate"
          value={
            typeof report.agreement_rate === "number"
              ? `${Math.round(report.agreement_rate * 100)}%`
              : "—"
          }
        />
        <Stat
          label="Audit band"
          value={report.audit_band ?? "—"}
          tone={
            report.audit_band === "material_drift"
              ? "warn"
              : report.audit_band === "watch"
              ? "warn"
              : "default"
          }
        />
      </div>

      {report.design_target_recommendation?.recommendation && (
        <section>
          <p className="text-xs font-semibold">
            Design-target ceiling recommendation
          </p>
          <p className="mt-1 text-sm">
            {report.design_target_recommendation.recommendation}
          </p>
          {report.design_target_recommendation.rationale && (
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              {report.design_target_recommendation.rationale}
            </p>
          )}
        </section>
      )}

      {report.implicated_standards && report.implicated_standards.length > 0 && (
        <section>
          <p className="text-xs font-semibold">
            Standards with highest past/present disagreement
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
        </section>
      )}

      {report.new_moment_candidates && report.new_moment_candidates.length > 0 && (
        <section>
          <p className="text-xs font-semibold">New-moment candidates</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-neutral-600 dark:text-neutral-400">
            {report.new_moment_candidates.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <section className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
      <p>
        No annual audit yet. The first cycle produces the baseline.
        See{" "}
        <code className="font-mono text-xs">
          evals/annual_audit/README.md
        </code>{" "}
        for the full workflow.
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
