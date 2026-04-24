/**
 * /accuracy — public accountability page.
 *
 * Human-eval build plan Session 24. Three distinct numbers, kept
 * visually + textually separate by design. Never combined into a
 * composite "accuracy score" — combining them would obscure the
 * self-drift ceiling and misrepresent the measurement.
 *
 * Data flows from `src/lib/accuracy-data.ts` which reads
 * `evals/graduation/readiness.json` (Session 10) and the latest
 * scored drift report under `evals/drift/reports/` (Session 7). The
 * page is a Server Component; build-time fs reads; static HTML.
 *
 * Reporting format follows Model Cards (Mitchell et al. 2019):
 * measured metrics with intervals, disaggregated by relevant factors,
 * pending cells rendered honestly as "pending" — never zero, never
 * the design target.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Sparkline } from "@/components/sparkline";
import {
  buildAccuracySnapshot,
  type Kappa,
  type StandardAccuracy,
} from "@/lib/accuracy-data";

export const metadata: Metadata = {
  title: "Accuracy — ContentRX",
  description:
    "Measured system κ, measured self-drift κ, and the design target — reported separately with 95% confidence intervals. No composite accuracy score.",
};

export default function AccuracyPage() {
  const snap = buildAccuracySnapshot();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Accountability surface
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          Accuracy, reported honestly
        </h1>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          Three numbers govern how ContentRX evaluates its own calibration.
          They are kept separate on purpose — a single &ldquo;accuracy score&rdquo;
          would obscure the self-drift ceiling and misrepresent what the
          measurement can actually say. This follows Model Cards (Mitchell
          et al., 2019) guidance on honest metric reporting with
          intervals and disaggregation.
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          Built {formatIso(snap.built_at)}. Snapshot from{" "}
          {snap.generated_at ? formatIso(snap.generated_at) : "an un-dated readiness.json"}.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <MetricBlock
          label="Measured system κ"
          sublabel="System vs Robo’s held-out golden verdicts"
          kappa={snap.measured_system}
        />
        <MetricBlock
          label="Measured self-drift κ"
          sublabel="Robo vs past-Robo (quarterly blind re-label)"
          kappa={snap.measured_self_drift}
        />
        <MetricBlock
          label="Design target κ"
          sublabel="A design assumption, not a measurement"
          kappa={{
            state: "measured",
            value: snap.design_target,
            ci_low: snap.design_target,
            ci_high: snap.design_target,
            sample_size: 0,
          }}
          isTarget
        />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Graduation ladder</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Every standard starts at <code className="font-mono">robo_labels</code>.
          It graduates when (a) its measured weekly κ stays above the
          threshold derived from the self-drift ceiling and (b) enough
          novel counterparts have been seen across moments and content
          types. Thresholds adjust automatically when the ceiling
          re-measures; see the{" "}
          <Link href="/dashboard/graduation" className="underline underline-offset-2">
            graduation dashboard
          </Link>{" "}
          for the mechanics.
        </p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <LadderCell label="robo_labels" count={snap.by_level.robo_labels} />
          <LadderCell label="batch_approval" count={snap.by_level.batch_approval} />
          <LadderCell label="autonomous" count={snap.by_level.autonomous} />
        </dl>
        <p className="mt-3 text-xs text-neutral-500">
          autonomous threshold κ ≥ {snap.thresholds.autonomous.toFixed(3)} ·
          batch_approval threshold κ ≥ {snap.thresholds.batch_approval.toFixed(3)}
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">
          Per-standard measurements
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {snap.standards.length} standards tracked. Cells show the
          per-standard κ alongside a sparkline of the last weekly
          measurements. &ldquo;Pending&rdquo; means the weekly κ series
          hasn&apos;t been populated yet — never zero, never filled
          from the design target.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                <th className="py-2 pr-4">Standard</th>
                <th className="py-2 pr-4">Level</th>
                <th className="py-2 pr-4">κ (95% CI)</th>
                <th className="py-2 pr-4">n</th>
                <th className="py-2 pr-4">Trend</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {snap.standards.map((s) => (
                <StandardRow
                  key={s.standard_id}
                  standard={s}
                  batchThreshold={snap.thresholds.batch_approval}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-neutral-300 bg-neutral-50 p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">Known failure modes</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Things ContentRX doesn&apos;t reliably catch yet, or reporting
          choices that might otherwise look like bugs.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          {snap.failure_modes.map((m) => (
            <li
              key={m.title}
              className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950"
            >
              <p className="font-medium">{m.title}</p>
              <p className="mt-1 text-neutral-700 dark:text-neutral-300">
                {m.description}
              </p>
              {m.known_since && (
                <p className="mt-1 text-xs text-neutral-500">
                  Known since {m.known_since}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Review queue phase</h2>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          {snap.review_queue_phase.description}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Current phase: <code className="font-mono">{snap.review_queue_phase.phase}</code>
        </p>
      </section>

      <footer className="mt-16 text-xs text-neutral-500">
        <p>
          Live metrics source:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/evals/graduation/readiness.json"
            className="underline underline-offset-2"
          >
            readiness.json
          </a>
          {" + "}
          <a
            href="https://github.com/thenewforktimes/contentRX/tree/main/evals/drift"
            className="underline underline-offset-2"
          >
            drift reports
          </a>
          . Page regenerates on every deploy; when{" "}
          <Link href="/dashboard/cadence/calibration" className="underline underline-offset-2">
            Session 7 re-measures the ceiling
          </Link>
          , this page updates on the next push. See{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>{" "}
          and{" "}
          <Link href="/sources" className="underline underline-offset-2">
            /sources
          </Link>{" "}
          for the rest of the accountability surface.
        </p>
      </footer>
    </main>
  );
}

function MetricBlock({
  label,
  sublabel,
  kappa,
  isTarget = false,
}: {
  label: string;
  sublabel: string;
  kappa: Kappa;
  isTarget?: boolean;
}) {
  return (
    <article
      className={`rounded-md border p-4 ${
        isTarget
          ? "border-dashed border-neutral-400 bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      }`}
    >
      <p className="text-xs font-mono uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        {sublabel}
      </p>
      <div className="mt-3">
        {kappa.state === "measured" ? (
          <>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {kappa.value.toFixed(3)}
            </p>
            {isTarget ? (
              <p className="mt-1 text-xs text-neutral-500">
                Design assumption · stated separately from measurements
              </p>
            ) : (
              <p className="mt-1 text-xs text-neutral-500 tabular-nums">
                95% CI [{kappa.ci_low.toFixed(3)}, {kappa.ci_high.toFixed(3)}] ·
                n = {kappa.sample_size}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-mono text-2xl font-semibold text-neutral-500">
              pending
            </p>
            <p className="mt-1 text-xs text-neutral-500">{kappa.reason}</p>
          </>
        )}
      </div>
    </article>
  );
}

function LadderCell({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">
        <code className="font-mono">{label}</code>
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{count}</dd>
    </div>
  );
}

function StandardRow({
  standard,
  batchThreshold,
}: {
  standard: StandardAccuracy;
  batchThreshold: number;
}) {
  const k = standard.kappa;
  const weeklyWindow: Array<number | null> = standard.weekly_kappa.slice(-8);
  return (
    <tr className="border-b border-neutral-100 dark:border-neutral-900">
      <td className="py-2 pr-4 font-mono text-xs">
        <Link
          href={`/dashboard/graduation`}
          className="underline underline-offset-2"
        >
          {standard.standard_id}
        </Link>
      </td>
      <td className="py-2 pr-4 text-xs font-mono text-neutral-600 dark:text-neutral-400">
        {standard.level}
      </td>
      <td className="py-2 pr-4 font-mono tabular-nums">
        {k.state === "measured" ? (
          <>
            {k.value.toFixed(3)}{" "}
            <span className="text-xs text-neutral-500">
              [{k.ci_low.toFixed(3)}, {k.ci_high.toFixed(3)}]
            </span>
          </>
        ) : (
          <span className="text-neutral-500">pending</span>
        )}
      </td>
      <td className="py-2 pr-4 font-mono tabular-nums text-xs">
        {k.state === "measured" ? k.sample_size : "—"}
      </td>
      <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-300">
        <Sparkline
          values={weeklyWindow}
          reference={batchThreshold}
          label={`Weekly kappa for ${standard.standard_id}`}
        />
      </td>
    </tr>
  );
}

function formatIso(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
