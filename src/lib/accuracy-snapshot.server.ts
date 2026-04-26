/**
 * Public accuracy snapshot loader.
 *
 * Phase C5 of the post-pivot rolling plan. Reads the public-safe
 * `reports/accuracy/latest.json` artifact written by
 * `reports/accuracy/generate.py` (Phase C1) and exposes a typed
 * shape for the public `/accuracy` page.
 *
 * Distinct from `src/lib/accuracy-data.ts`, which loads the
 * substrate (`evals/graduation/readiness.json` + drift reports)
 * directly for the founder-only `/admin/calibration` page. Keeping
 * the loaders separate behind `server-only` means the public page
 * can never accidentally import the substrate path — the
 * type-system makes the privacy boundary visible.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";

export type Kappa =
  | {
      state: "measured";
      value: number;
      ci_low: number;
      ci_high: number;
      sample_size: number;
    }
  | { state: "pending_measurement"; reason: string };

export interface PublicAccuracySnapshot {
  schema_version: string;
  generated_at: string;
  measured_system: Kappa;
  measured_self_drift: Kappa;
  design_target: number;
  by_level: {
    robo_labels: number;
    batch_approval: number;
    autonomous: number;
  };
  standards_measured: number;
  standards_total: number;
}

const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "reports",
  "accuracy",
  "latest.json",
);

const PENDING_NO_FILE: Kappa = {
  state: "pending_measurement",
  reason:
    "no reports/accuracy/latest.json — the nightly generator has not run yet",
};

export function loadPublicAccuracySnapshot(): PublicAccuracySnapshot {
  let raw: string;
  try {
    raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
  } catch {
    return emptySnapshot();
  }
  let parsed: Partial<PublicAccuracySnapshot>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySnapshot();
  }
  return {
    schema_version: typeof parsed.schema_version === "string"
      ? parsed.schema_version
      : "0.0.0",
    generated_at: typeof parsed.generated_at === "string"
      ? parsed.generated_at
      : "",
    measured_system: normaliseKappa(parsed.measured_system),
    measured_self_drift: normaliseKappa(parsed.measured_self_drift),
    design_target: typeof parsed.design_target === "number"
      ? parsed.design_target
      : 0.9,
    by_level: {
      robo_labels: countOrZero(parsed.by_level?.robo_labels),
      batch_approval: countOrZero(parsed.by_level?.batch_approval),
      autonomous: countOrZero(parsed.by_level?.autonomous),
    },
    standards_measured: typeof parsed.standards_measured === "number"
      ? parsed.standards_measured
      : 0,
    standards_total: typeof parsed.standards_total === "number"
      ? parsed.standards_total
      : 47,
  };
}

function emptySnapshot(): PublicAccuracySnapshot {
  return {
    schema_version: "0.0.0",
    generated_at: "",
    measured_system: PENDING_NO_FILE,
    measured_self_drift: PENDING_NO_FILE,
    design_target: 0.9,
    by_level: {
      robo_labels: 0,
      batch_approval: 0,
      autonomous: 0,
    },
    standards_measured: 0,
    standards_total: 47,
  };
}

function normaliseKappa(value: unknown): Kappa {
  if (value === null || typeof value !== "object") {
    return { state: "pending_measurement", reason: "missing field" };
  }
  const k = value as Record<string, unknown>;
  if (k.state === "measured" && typeof k.value === "number") {
    return {
      state: "measured",
      value: k.value,
      ci_low: typeof k.ci_low === "number" ? k.ci_low : k.value,
      ci_high: typeof k.ci_high === "number" ? k.ci_high : k.value,
      sample_size:
        typeof k.sample_size === "number" ? k.sample_size : 0,
    };
  }
  if (k.state === "pending_measurement") {
    return {
      state: "pending_measurement",
      reason: typeof k.reason === "string" ? k.reason : "pending",
    };
  }
  return {
    state: "pending_measurement",
    reason: "unrecognised kappa shape",
  };
}

function countOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
