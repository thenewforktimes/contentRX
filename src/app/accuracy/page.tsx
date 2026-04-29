/**
 * /accuracy — public accountability page.
 *
 * Phase C5 of the post-pivot rolling plan. Three distinct numbers,
 * kept visually + textually separate by design. Never combined into
 * a composite "accuracy score" — combining them would obscure the
 * self-drift ceiling and misrepresent the measurement.
 *
 * Data source: `reports/accuracy/latest.json`, written by the C1
 * generator from substrate. The public artifact carries only the
 * load-bearing public numbers (system κ, self-drift κ, design
 * target, by_level counts) — never per-standard kappa or any other
 * substrate field. The founder-only `/admin/calibration` page shows
 * the per-standard breakdown under auth.
 *
 * Reporting format follows Model Cards (Mitchell et al. 2019):
 * measured metrics with intervals, pending cells rendered honestly
 * as "pending" — never zero, never the design target.
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  loadPublicAccuracySnapshot,
  type Kappa,
} from "@/lib/accuracy-snapshot.server";

export const metadata: Metadata = {
  title: "Accuracy. ContentRX",
  description:
    "Measured system κ, measured self-drift κ, and the design target. Reported separately with 95% confidence intervals. No composite accuracy score.",
};

export default function AccuracyPage() {
  const snap = loadPublicAccuracySnapshot();

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
          They are kept separate on purpose. A single &ldquo;accuracy score&rdquo;
          would obscure the self-drift ceiling and misrepresent what the
          measurement can actually say. This follows Model Cards (Mitchell
          et al., 2019) guidance on honest metric reporting with
          intervals.
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          {snap.generated_at
            ? `Snapshot generated ${formatIso(snap.generated_at)}.`
            : "Snapshot pending. The nightly generator has not run yet."}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <MetricBlock
          label="Measured system κ"
          sublabel="System vs Robo&apos;s held-out golden verdicts"
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
        <h2 className="text-lg font-semibold">Coverage</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          ContentRX evaluates against {snap.standards_total} standards. As
          standards accumulate enough labelled data, they graduate up the
          ladder from <code className="font-mono">robo_labels</code> (every
          verdict reviewed) to <code className="font-mono">batch_approval</code>{" "}
          (sampled review) to <code className="font-mono">autonomous</code>{" "}
          (no per-verdict review). Per-standard measurements are kept
          internal. The page is a calibration surface, not a rule
          catalogue.
        </p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <LadderCell label="robo_labels" count={snap.by_level.robo_labels} />
          <LadderCell
            label="batch_approval"
            count={snap.by_level.batch_approval}
          />
          <LadderCell label="autonomous" count={snap.by_level.autonomous} />
        </dl>
        <p className="mt-3 text-xs text-neutral-500">
          {snap.standards_measured} of {snap.standards_total} standards have
          completed the weekly κ series.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-neutral-300 bg-neutral-50 p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">How these numbers come to be</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Each weekday the engine evaluates strings against the standards
          library and a held-out golden set Robo maintains. The measured
          system κ is the agreement between what the engine says and what
          Robo would say on the same input. The self-drift κ is the
          agreement between Robo and a past version of Robo on the same
          panel: the expert ceiling, since the system can&apos;t exceed
          the labeller&apos;s agreement with themselves. The 0.90 design
          target is a stated assumption, not a measurement.
        </p>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          Pending cells render as &ldquo;pending&rdquo;: never zero, never
          filled from the design target. Honest reporting of a
          measurement-in-progress is the whole point of the page.
        </p>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          The weekly{" "}
          <Link href="/calibration" className="underline underline-offset-2">
            calibration log
          </Link>{" "}
          tracks κ movement, drift signals, and active refinement
          candidates from the taxonomy refinement log.
        </p>
      </section>

      <footer className="mt-16 text-xs text-neutral-500">
        <p>
          Public snapshot at{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/reports/accuracy/latest.json"
            className="underline underline-offset-2"
          >
            reports/accuracy/latest.json
          </a>
          , generated nightly by the substrate-to-report pipeline. The
          docs site picks up the file on next deploy. Schema version{" "}
          <code className="font-mono">{snap.schema_version}</code>. See{" "}
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
                95% CI [{kappa.ci_low.toFixed(3)},{" "}
                {kappa.ci_high.toFixed(3)}] · n = {kappa.sample_size}
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

function LadderCell({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">
        <code className="font-mono">{label}</code>
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{count}</dd>
    </div>
  );
}

function formatIso(iso: string): string {
  if (!iso) return "pending";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
