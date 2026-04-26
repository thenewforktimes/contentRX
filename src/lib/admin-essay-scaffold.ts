/**
 * Pure scaffold generator for `/admin/essay-drafts`.
 *
 * Phase B7 of the post-pivot rolling plan. Pulls the latest
 * `/accuracy` numbers, the most recent calibration-log entry, and
 * the most active refinement-log entries to produce a ~200-word
 * scaffold the founder can open with. The scaffold is templated
 * (consistency-of-format matters across weekly cadence) — the
 * founder writes the actual essay; this just removes the cold-start
 * tax.
 *
 * Lives in a non-server module so vitest can exercise the
 * templating logic without webpack tripping over `server-only`. The
 * server-side page composes the loaders and hands the structured
 * inputs to `buildEssayScaffold()`.
 */

import type { Kappa } from "./accuracy-data";
import type { RefinementEntry } from "./admin-refinement-log-parser";

export interface EssayScaffoldInput {
  measured_system: Kappa;
  measured_self_drift: Kappa;
  design_target: number;
  /** Filename of the most recent calibration entry (e.g. "2026-15.md"); null if none. */
  recent_calibration_filename: string | null;
  /** mtime of the most recent calibration entry, or null when there is none. */
  recent_calibration_modified_at: string | null;
  /** Active refinement-log entries — ideally up to 3 currently in the open bucket. */
  active_refinements: RefinementEntry[];
  /** Override count over the trailing window (last 30 days). */
  override_count_30d: number;
}

export interface EssayScaffold {
  title: string;
  body: string;
  word_count: number;
  /** When buildScaffold ran. ISO-formatted. */
  generated_at: string;
}

const NUMBER_FORMATTER = (() => {
  try {
    return new Intl.NumberFormat("en-US");
  } catch {
    return null;
  }
})();

function formatNumber(n: number): string {
  return NUMBER_FORMATTER ? NUMBER_FORMATTER.format(n) : String(n);
}

export function buildEssayScaffold(
  input: EssayScaffoldInput,
  now: Date = new Date(),
): EssayScaffold {
  const week = isoWeek(now);
  const title = `Calibration log, week ${week}`;

  const lines: string[] = [];

  // Open with the system kappa headline.
  if (input.measured_system.state === "measured") {
    const k = input.measured_system;
    lines.push(
      `This week's measured system κ is ${k.value.toFixed(3)} (95% CI [${k.ci_low.toFixed(
        3,
      )}, ${k.ci_high.toFixed(3)}], n=${formatNumber(k.sample_size)}). The design target stays at ${input.design_target.toFixed(2)} — a stated assumption, never a measured number.`,
    );
  } else {
    lines.push(
      `Measured system κ is still pending — ${input.measured_system.reason}. The design target remains ${input.design_target.toFixed(2)} as a stated assumption.`,
    );
  }

  // Self-drift.
  if (input.measured_self_drift.state === "measured") {
    const sd = input.measured_self_drift;
    lines.push(
      `Self-drift κ — Robo vs past-Robo on the held-out panel — is ${sd.value.toFixed(3)} (95% CI [${sd.ci_low.toFixed(
        3,
      )}, ${sd.ci_high.toFixed(3)}]). That's the expert ceiling; the system can't out-perform the labeler against itself.`,
    );
  } else {
    lines.push(
      `Self-drift κ remains pending — ${input.measured_self_drift.reason}. The expert ceiling will land once the held-out panel is re-labeled and scored.`,
    );
  }

  // Override stream.
  lines.push(
    `${formatNumber(input.override_count_30d)} override${
      input.override_count_30d === 1 ? "" : "s"
    } logged across the last 30 days. Each one is implicit feedback against a verdict — high counts on a single rule are the signal that earns it a refinement-log entry.`,
  );

  // Active refinements (up to 3).
  if (input.active_refinements.length > 0) {
    const focus = input.active_refinements.slice(0, 3);
    lines.push("Active refinement candidates:");
    for (const r of focus) {
      const headline = r.title || r.proposed_split || r.current_category || r.id;
      const trim =
        headline.length > 80 ? `${headline.slice(0, 77)}…` : headline;
      lines.push(`  - ${r.id}: ${trim}`);
    }
  } else {
    lines.push(
      "No open refinement candidates — the queue is clean this week. Use that as license to write more about a single high-traffic standard rather than a survey.",
    );
  }

  // Calibration-log handoff.
  if (input.recent_calibration_filename) {
    lines.push(
      `Anchor the post against this week's calibration log entry: reports/calibration/${input.recent_calibration_filename}. Cite the moving κ deltas + override count from that file rather than reproducing them inline.`,
    );
  } else {
    lines.push(
      "There's no calibration log entry yet — Phase C ships the generator that emits weekly markdown into reports/calibration/. Once that lands, anchor the essay against it instead of reproducing the numbers inline.",
    );
  }

  // Closing nudge — voice prompt rather than copy to keep.
  lines.push(
    "Open with a specific decision the kappa moved this week, not with the metric itself. The metric is evidence; the decision is the story.",
  );

  const body = lines.join("\n\n");
  const word_count = countWords(body);

  return {
    title,
    body,
    word_count,
    generated_at: now.toISOString(),
  };
}

function isoWeek(date: Date): string {
  // ISO-8601 week number (1–53). Pure JS implementation so we don't
  // pull in date-fns just for this.
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${target.getUTCFullYear()}-${String(weekNum).padStart(2, "0")}`;
}

function countWords(s: string): number {
  return s
    .replace(/[\s\n]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}
