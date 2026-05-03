/**
 * `/admin/calibration` — substrate calibration view.
 *
 * Phase B5 + B5b of the post-pivot rolling plan. The substrate that
 * produces the public `/accuracy` page and the weekly calibration
 * log. Surfaces:
 *
 *   - Overall measured system κ + self-drift κ (with 95% CIs).
 *   - The 0.90 design target as a separate, never-combined number.
 *   - System κ trend chart (B5b) — Recharts line chart of weekly κ
 *     aggregated across measured standards. Reference lines for the
 *     design target and the autonomous threshold.
 *   - Per-standard kappa table — one row per standard with current
 *     kappa, weekly trend (text sparkline), graduation level,
 *     prevalence.
 *   - Override-stream rollups by standard_id for the last 30 days,
 *     joined back to the kappa table where applicable.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import { desc, sql } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import {
  buildAccuracySnapshot,
  type Kappa,
  type StandardAccuracy,
} from "@/lib/accuracy-data";
import { CalibrationCharts } from "./calibration-charts-client";
import type { SystemKappaPoint } from "./charts";

const OVERRIDE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const metadata = {
  title: "Calibration · ContentRX admin",
  robots: { index: false, follow: false },
};

export default async function AdminCalibrationPage() {
  const snapshot = buildAccuracySnapshot();
  const overrideCounts = await loadOverrideCounts();
  const systemKappaTrend = aggregateSystemKappaTrend(snapshot.standards);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-strong">
          Calibration
        </h1>
        <p className="mt-1 text-sm text-quiet">
          Substrate metrics that produce the public <code className="font-mono text-xs">/accuracy</code>{" "}
          page and the weekly calibration log. The three κ numbers below stay
          visually distinct on purpose — never combine them into a composite
          score.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <KappaCard
          label="Measured system κ"
          subtitle="System verdicts vs Robert's golden labels"
          kappa={snapshot.measured_system}
        />
        <KappaCard
          label="Measured self-drift κ"
          subtitle="Robert vs past-Robert on the held-out panel"
          kappa={snapshot.measured_self_drift}
        />
        <DesignTargetCard target={snapshot.design_target} />
      </section>

      <section aria-labelledby="trend" className="space-y-2">
        <h2
          id="trend"
          className="text-sm font-semibold uppercase tracking-wide text-quiet"
        >
          System κ trend
        </h2>
        <p className="text-xs text-quiet">
          Weekly κ aggregated across all standards with measured weekly
          values. Reference lines mark the autonomous threshold and the
          0.90 design target.
        </p>
        <CalibrationCharts
          points={systemKappaTrend}
          designTarget={snapshot.design_target}
          autonomousThreshold={snapshot.thresholds.autonomous}
        />
      </section>

      <section aria-labelledby="thresholds" className="space-y-2">
        <h2
          id="thresholds"
          className="text-sm font-semibold uppercase tracking-wide text-quiet"
        >
          Graduation thresholds
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <ThresholdCard
            label="Autonomous"
            value={snapshot.thresholds.autonomous}
            count={snapshot.by_level.autonomous}
          />
          <ThresholdCard
            label="Batch approval"
            value={snapshot.thresholds.batch_approval}
            count={snapshot.by_level.batch_approval}
          />
          <ThresholdCard
            label="Every verdict reviewed"
            value={null}
            count={snapshot.by_level.robo_labels}
            note="No threshold — manual review tier."
          />
        </dl>
      </section>

      <section aria-labelledby="standards-table" className="space-y-3">
        <h2
          id="standards-table"
          className="text-sm font-semibold uppercase tracking-wide text-quiet"
        >
          Per-standard kappa
        </h2>
        {snapshot.standards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong bg-white p-6 text-center text-sm text-quiet dark:bg-stone-900">
            No per-standard kappa available yet. Run{" "}
            <code className="font-mono text-xs">tools/graduation_metrics.py</code>{" "}
            and commit{" "}
            <code className="font-mono text-xs">evals/graduation/readiness.json</code>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-white dark:bg-stone-900">
            <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-800">
              <thead className="text-xs uppercase tracking-wide text-quiet">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Standard</th>
                  <th scope="col" className="px-3 py-2 text-left">Level</th>
                  <th scope="col" className="px-3 py-2 text-left">κ (95% CI)</th>
                  <th scope="col" className="px-3 py-2 text-left">Weekly trend</th>
                  <th scope="col" className="px-3 py-2 text-right">Overrides ({OVERRIDE_WINDOW_DAYS}d)</th>
                  <th scope="col" className="px-3 py-2 text-right">Prevalence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {snapshot.standards.map((s) => (
                  <StandardRow
                    key={s.standard_id}
                    standard={s}
                    overrideCount={overrideCounts.get(s.standard_id) ?? 0}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KappaCard({
  label,
  subtitle,
  kappa,
}: {
  label: string;
  subtitle: string;
  kappa: Kappa;
}) {
  return (
    <article className="rounded-lg border border-line bg-white p-4 dark:bg-stone-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
        {label}
      </p>
      <p className="mt-1 text-xs text-quiet">
        {subtitle}
      </p>
      <p className="mt-3">
        {kappa.state === "measured" ? (
          <>
            <span className="font-mono text-2xl font-semibold text-strong">
              {kappa.value.toFixed(3)}
            </span>
            <span className="ml-2 font-mono text-xs text-quiet">
              [{kappa.ci_low.toFixed(3)}, {kappa.ci_high.toFixed(3)}]
            </span>
          </>
        ) : (
          <span className="text-sm italic text-quiet">
            pending — {kappa.reason}
          </span>
        )}
      </p>
      {kappa.state === "measured" && (
        <p className="mt-1 font-mono text-[10px] text-quiet">
          n = {kappa.sample_size}
        </p>
      )}
    </article>
  );
}

function DesignTargetCard({ target }: { target: number }) {
  return (
    <article className="rounded-lg border-2 border-dashed border-line-strong bg-stone-50 p-4 dark:bg-stone-950">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
        Design target
      </p>
      <p className="mt-1 text-xs text-quiet">
        Locked. A design assumption, not a measurement.
      </p>
      <p className="mt-3">
        <span className="font-mono text-2xl font-semibold text-strong">
          {target.toFixed(2)}
        </span>
      </p>
    </article>
  );
}

function ThresholdCard({
  label,
  value,
  count,
  note,
}: {
  label: string;
  value: number | null;
  count: number;
  note?: string;
}) {
  return (
    <article className="rounded-lg border border-line bg-white p-3 dark:bg-stone-900">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
          {label}
        </span>
        <span className="font-mono text-xs text-default">
          {count} standard{count === 1 ? "" : "s"}
        </span>
      </div>
      {value !== null && (
        <p className="mt-2 font-mono text-sm text-strong">
          κ ≥ {value.toFixed(3)}
        </p>
      )}
      {note && (
        <p className="mt-1 text-xs text-quiet">
          {note}
        </p>
      )}
    </article>
  );
}

function StandardRow({
  standard,
  overrideCount,
}: {
  standard: StandardAccuracy;
  overrideCount: number;
}) {
  const k = standard.kappa;
  return (
    <tr className="hover:bg-hover /50">
      <td className="px-3 py-2">
        <Link
          href={`/admin/model/standards/${standard.standard_id}`}
          className="font-mono text-xs text-default hover:underline"
        >
          {standard.standard_id}
        </Link>
      </td>
      <td className="px-3 py-2 text-xs text-default">
        {standard.level.replace(/_/g, " ")}
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {k.state === "measured" ? (
          <span>
            {k.value.toFixed(3)}
            <span className="ml-1 text-[10px] text-quiet">
              [{k.ci_low.toFixed(3)}, {k.ci_high.toFixed(3)}]
            </span>
          </span>
        ) : (
          <span className="italic text-quiet">pending</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        <Sparkline values={standard.weekly_kappa} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-default">
        {overrideCount}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-default">
        {standard.prevalence === null ? "—" : standard.prevalence.toFixed(3)}
      </td>
    </tr>
  );
}

/**
 * Text sparkline using Unicode blocks. A pure-CSS Recharts replacement
 * that works in server-rendered tables. Each value [0, 1] maps to one
 * of eight block heights; nulls render as a thin dim mark.
 */
function Sparkline({ values }: { values: Array<number | null> }) {
  if (values.length === 0) {
    return <span className="text-quiet">—</span>;
  }
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  return (
    <span className="font-mono text-base leading-none tracking-tight text-default">
      {values.map((v, i) => {
        if (v === null) {
          return (
            <span key={i} className="text-quiet">
              ·
            </span>
          );
        }
        const clamped = Math.max(0, Math.min(1, v));
        const idx = Math.min(blocks.length - 1, Math.floor(clamped * blocks.length));
        return <span key={i}>{blocks[idx]}</span>;
      })}
    </span>
  );
}

/**
 * Aggregate per-standard weekly_kappa arrays into a system-level
 * series. For each week index i, the system value is the simple
 * mean of every standard's weekly_kappa[i] that is measured (non-null).
 *
 * The resulting `points` array is oldest-first: index 0 is the
 * oldest week in the trailing window, the last entry is "this week"
 * at week_offset=0.
 */
function aggregateSystemKappaTrend(
  standards: StandardAccuracy[],
): SystemKappaPoint[] {
  let maxWeeks = 0;
  for (const s of standards) {
    if (s.weekly_kappa.length > maxWeeks) maxWeeks = s.weekly_kappa.length;
  }
  if (maxWeeks === 0) return [];

  const points: SystemKappaPoint[] = [];
  for (let i = 0; i < maxWeeks; i++) {
    let sum = 0;
    let count = 0;
    let sampleSize = 0;
    for (const s of standards) {
      const v = s.weekly_kappa[i];
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        count += 1;
        if (s.kappa.state === "measured") {
          sampleSize += s.kappa.sample_size;
        }
      }
    }
    if (count === 0) continue;
    // week_offset is 0 for the most recent week (last index), negative
    // going back. So if maxWeeks=8 and i=0, week_offset = -7.
    const weekOffset = i - (maxWeeks - 1);
    points.push({
      week_offset: weekOffset,
      kappa: round3(sum / count),
      sample_size: sampleSize,
    });
  }
  return points;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function loadOverrideCounts(): Promise<Map<string, number>> {
  const since = new Date(Date.now() - OVERRIDE_WINDOW_DAYS * DAY_MS);
  const db = getDb();
  const rows = await db
    .select({
      standardId: schema.violationOverrides.standardId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violationOverrides)
    .where(
      sql`${schema.violationOverrides.createdAt} >= ${since.toISOString()}`,
    )
    .groupBy(schema.violationOverrides.standardId)
    .orderBy(desc(sql`count(*)`));
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.standardId) out.set(r.standardId, Number(r.count));
  }
  return out;
}
