/**
 * /accuracy page data aggregator.
 *
 * Human-eval build plan Session 24. Loads the committed graduation
 * readiness snapshot (`evals/graduation/readiness.json`, written by
 * `tools/graduation_metrics.py`) plus any scored self-drift reports
 * (`evals/drift/reports/*.json`, written by `tools/drift_check.py
 * score`) and shapes them for the public accountability page.
 *
 * Three numbers must stay visually and logically distinct in the
 * rendered page — never combined into a composite "accuracy score":
 *
 *   1. Measured system κ (system vs Robert's held-out golden verdicts,
 *      with 95% CI).
 *   2. Measured self-drift κ (Robert vs past-Robert from the Session 7
 *      quarterly panel, with 95% CI). This is the expert ceiling.
 *   3. Design target κ = 0.90. A design assumption, not a measurement.
 *
 * The page is a Server Component; this module runs at build time and
 * the aggregated output is inlined into the static HTML. No runtime
 * fs reads, no per-request work.
 *
 * Pre-measurement state (Sessions 7 + 10 have the instrumentation in
 * place but the drift panel and weekly kappa haven't been scored yet)
 * is surfaced honestly with `"pending_measurement"` sentinel values —
 * never coerced to 0 or to the design target.
 */

import fs from "node:fs";
import path from "node:path";

export const DESIGN_TARGET_KAPPA = 0.9;

export type Kappa =
  | { state: "measured"; value: number; ci_low: number; ci_high: number; sample_size: number }
  | { state: "pending_measurement"; reason: string };

export type GraduationLevel = "robo_labels" | "batch_approval" | "autonomous";

export interface StandardAccuracy {
  standard_id: string;
  level: GraduationLevel;
  kappa: Kappa;
  prevalence: number | null;
  weekly_kappa: Array<number | null>;
}

export interface AccuracySnapshot {
  /** When the underlying metrics files were generated. */
  generated_at: string;
  /** When this aggregator ran (i.e. when the page was built). */
  built_at: string;
  /** Overall system κ (system vs Robert's golden verdicts). */
  measured_system: Kappa;
  /** Self-drift κ (Robert re-labelling the Session 7 panel). */
  measured_self_drift: Kappa;
  /** Design target. Locked at 0.90 per the plan's acceptance criteria. */
  design_target: number;
  /** Kappa thresholds derived from the measured ceiling. */
  thresholds: {
    autonomous: number;
    batch_approval: number;
  };
  /** Count of standards at each graduation level. */
  by_level: Record<GraduationLevel, number>;
  /** Per-standard breakdown. */
  standards: StandardAccuracy[];
  /** Honest failure-mode disclosures. */
  failure_modes: FailureMode[];
  /** Review-queue phase indicator (Session 8). */
  review_queue_phase: ReviewQueuePhase;
}

export interface FailureMode {
  title: string;
  description: string;
  known_since?: string;
}

export interface ReviewQueuePhase {
  phase: "early" | "late";
  description: string;
}

interface ReadinessStandardRaw {
  standard_id: string;
  recommended_level?: GraduationLevel;
  prevalence?: number | null;
  autonomous?: {
    eligible?: boolean;
    criteria?: {
      kappa?: {
        value?: number | null;
        weekly?: Array<number | null> | null;
      };
      sample_size?: { value?: number | null };
    };
  };
  batch_approval?: {
    eligible?: boolean;
    criteria?: {
      kappa?: {
        value?: number | null;
        weekly?: Array<number | null> | null;
      };
      sample_size?: { value?: number | null };
    };
  };
}

interface ReadinessFile {
  schema_version?: string;
  generated_at?: string;
  measured_ceiling?: number;
  autonomous_kappa_threshold?: number;
  batch_approval_kappa_threshold?: number;
  standards_evaluated?: number;
  by_level?: Partial<Record<GraduationLevel, number>>;
  standards?: ReadinessStandardRaw[];
}

interface DriftReport {
  quarter: string;
  kappa?: number | null;
  kappa_ci_low?: number | null;
  kappa_ci_high?: number | null;
  sample_size?: number | null;
  generated_at?: string;
}

function safeReadJson<T>(relPath: string): T | null {
  const p = path.join(process.cwd(), relPath);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadLatestDriftReport(): DriftReport | null {
  const dir = path.join(process.cwd(), "evals", "drift", "reports");
  if (!fs.existsSync(dir)) return null;
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  // Quarter filenames sort lexically (e.g. 2026-q1.json < 2026-q2.json).
  files.sort((a, b) => b.localeCompare(a));
  const latest = path.join(dir, files[0]!);
  try {
    return JSON.parse(fs.readFileSync(latest, "utf-8")) as DriftReport;
  } catch {
    return null;
  }
}

function pickKappa(raw: ReadinessStandardRaw): {
  kappa: Kappa;
  weekly: Array<number | null>;
} {
  // Prefer autonomous-tier kappa when present; fall back to
  // batch_approval; otherwise pending.
  const auto = raw.autonomous?.criteria?.kappa;
  const batch = raw.batch_approval?.criteria?.kappa;
  const autoSample = raw.autonomous?.criteria?.sample_size?.value ?? 0;
  const batchSample = raw.batch_approval?.criteria?.sample_size?.value ?? 0;

  if (auto && typeof auto.value === "number") {
    return {
      kappa: kappaFromPoint(auto.value, autoSample),
      weekly: (auto.weekly ?? []).slice(),
    };
  }
  if (batch && typeof batch.value === "number") {
    return {
      kappa: kappaFromPoint(batch.value, batchSample),
      weekly: (batch.weekly ?? []).slice(),
    };
  }
  return {
    kappa: { state: "pending_measurement", reason: "no weekly kappa yet" },
    weekly: [],
  };
}

/**
 * Derive a 95% CI from a point estimate + sample size. The readiness
 * tool doesn't currently emit CIs — we surface the point with a
 * deterministic CI estimator (±1.96 × √((1 − κ²) / n)) so the shape
 * is honest even when n is small. Callers can replace the kappa with
 * a direct `{state: "measured", ci_low, ci_high, …}` once the drift
 * panel is scored and ships explicit CIs.
 */
function kappaFromPoint(value: number, sampleSize: number): Kappa {
  if (sampleSize <= 0) {
    return {
      state: "measured",
      value,
      ci_low: value,
      ci_high: value,
      sample_size: 0,
    };
  }
  const variance = (1 - value * value) / sampleSize;
  const half = 1.96 * Math.sqrt(Math.max(variance, 0));
  return {
    state: "measured",
    value,
    ci_low: Math.max(-1, value - half),
    ci_high: Math.min(1, value + half),
    sample_size: sampleSize,
  };
}

function normaliseByLevel(
  by: Partial<Record<GraduationLevel, number>> | undefined,
): Record<GraduationLevel, number> {
  return {
    robo_labels: by?.robo_labels ?? 0,
    batch_approval: by?.batch_approval ?? 0,
    autonomous: by?.autonomous ?? 0,
  };
}

/**
 * The failure-mode disclosures are plan-locked honest statements of
 * what the tool doesn't catch yet. The list grows as human-eval
 * annotations surface new categories. Added here rather than in the
 * page so tests can assert the public text.
 */
const STATIC_FAILURE_MODES: FailureMode[] = [
  {
    title: "Composite accuracy score not reported",
    description:
      "The three kappa numbers are kept separate by design. Combining them into one headline number would obscure the self-drift ceiling and misrepresent the measurement.",
    known_since: "2026-04-23",
  },
  {
    title: "Pre-measurement: weekly kappa series not yet populated",
    description:
      "The quarterly self-drift panel will be regenerated locally from license-compatible cases (the prior committed manifest was retired in the 2026-05-06 product-extraction cleanup); the blind re-label pass hasn't been scored yet. Per-standard kappa cells will be populated as annotations land. Cells show 'pending' until then — never zero, never a guess.",
    known_since: "2026-04-23",
  },
  {
    title: "Novel-counterpart coverage is uneven",
    description:
      "Every standard needs ≥12 counterpart cases (within-moment, cross-content-type, cross-moment) before it can graduate past robo_labels. Several standards still carry 'no counterparts provided' in the readiness report. Graduation blocked on counterpart acquisition, not on the underlying κ.",
  },
  {
    title: "Prevalence-driven MCC supplementation",
    description:
      "Standards with observed prevalence below 5% trigger MCC (Matthews correlation) supplementation so imbalanced labels don't inflate kappa. The threshold is reported per-standard when it fires.",
  },
];

function reviewQueuePhase(
  totalStandards: number,
  standardsWithKappa: number,
): ReviewQueuePhase {
  if (standardsWithKappa === 0) {
    return {
      phase: "early",
      description:
        "No standards have populated kappa series yet. The review queue is in its seeding phase — Robert is annotating the industry corpus.",
    };
  }
  if (standardsWithKappa < totalStandards / 2) {
    return {
      phase: "early",
      description: `${standardsWithKappa} of ${totalStandards} standards have kappa measurements. The review queue is still early-phase — expect the precedent index to climb quickly over the next quarter.`,
    };
  }
  return {
    phase: "late",
    description: `${standardsWithKappa} of ${totalStandards} standards carry kappa measurements. The review queue has matured past its seeding phase; most incoming cases match an existing precedent.`,
  };
}

export function buildAccuracySnapshot(
  nowIso: string = new Date().toISOString(),
): AccuracySnapshot {
  const readiness = safeReadJson<ReadinessFile>(
    path.join("evals", "graduation", "readiness.json"),
  );
  const drift = loadLatestDriftReport();

  const standardsRaw = readiness?.standards ?? [];
  const standards: StandardAccuracy[] = standardsRaw.map((raw) => {
    const { kappa, weekly } = pickKappa(raw);
    return {
      standard_id: raw.standard_id,
      level: raw.recommended_level ?? "robo_labels",
      kappa,
      prevalence:
        typeof raw.prevalence === "number" ? raw.prevalence : null,
      weekly_kappa: weekly,
    };
  });

  const standardsWithKappa = standards.filter(
    (s) => s.kappa.state === "measured",
  ).length;

  const measuredSystem: Kappa = standardsWithKappa > 0
    ? aggregateSystemKappa(standards)
    : {
        state: "pending_measurement",
        reason: "no standards have completed the weekly kappa series",
      };

  const measuredSelfDrift: Kappa = drift && typeof drift.kappa === "number"
    ? {
        state: "measured",
        value: drift.kappa,
        ci_low: drift.kappa_ci_low ?? drift.kappa,
        ci_high: drift.kappa_ci_high ?? drift.kappa,
        sample_size: drift.sample_size ?? 0,
      }
    : {
        state: "pending_measurement",
        reason: "Session 7 drift panel awaiting blind re-label + score",
      };

  return {
    generated_at: readiness?.generated_at ?? "",
    built_at: nowIso,
    measured_system: measuredSystem,
    measured_self_drift: measuredSelfDrift,
    design_target: DESIGN_TARGET_KAPPA,
    thresholds: {
      autonomous: readiness?.autonomous_kappa_threshold ?? 0.846,
      batch_approval: readiness?.batch_approval_kappa_threshold ?? 0.747,
    },
    by_level: normaliseByLevel(readiness?.by_level),
    standards,
    failure_modes: STATIC_FAILURE_MODES,
    review_queue_phase: reviewQueuePhase(standards.length, standardsWithKappa),
  };
}

function aggregateSystemKappa(
  standards: StandardAccuracy[],
): Kappa {
  let sumValue = 0;
  let sumWeight = 0;
  let ciLow = 0;
  let ciHigh = 0;
  let totalSample = 0;
  for (const s of standards) {
    if (s.kappa.state !== "measured") continue;
    const weight = Math.max(1, s.kappa.sample_size);
    sumValue += s.kappa.value * weight;
    ciLow += s.kappa.ci_low * weight;
    ciHigh += s.kappa.ci_high * weight;
    sumWeight += weight;
    totalSample += s.kappa.sample_size;
  }
  if (sumWeight === 0) {
    return {
      state: "pending_measurement",
      reason: "no weighted kappa measurements available",
    };
  }
  return {
    state: "measured",
    value: sumValue / sumWeight,
    ci_low: ciLow / sumWeight,
    ci_high: ciHigh / sumWeight,
    sample_size: totalSample,
  };
}
