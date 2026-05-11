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
import { AuthorBlock } from "@/components/author-block";
import { Divider } from "@/components/ui/divider";
import { PageHeader } from "@/components/ui/page-header";
import {
  loadPublicAccuracySnapshot,
  type Kappa,
} from "@/lib/accuracy-snapshot.server";
import { listCalibrationLogs } from "@/lib/calibration-loader.server";

export const metadata: Metadata = {
  title: "Accuracy. ContentRX",
  description:
    "Measured system κ, measured self-drift κ, and the design target. Reported separately with 95% confidence intervals. No composite accuracy score.",
};

export default function AccuracyPage() {
  const snap = loadPublicAccuracySnapshot();
  const calibrationEntries = listCalibrationLogs();

  return (
    <main className="mx-auto max-w-4xl px-6 py-20">
      <PageHeader
        eyebrow="Accuracy"
        title="How I measure accuracy"
        lede={
          <p className="text-sm text-quiet">
            Three numbers describe how ContentRX scores against a fixed
            bar. They&rsquo;re kept separate on purpose. A single
            &ldquo;accuracy score&rdquo; would hide the self-drift
            ceiling and overstate what the system can know about
            itself. The reporting format (measured numbers, 95%
            intervals, pending cells named honestly) follows the Model
            Cards pattern from Mitchell et al., 2019.
          </p>
        }
        meta={
          <>
            {snap.generated_at
              ? `Snapshot generated ${formatIso(snap.generated_at)}.`
              : "Snapshot pending. The nightly generator has not run yet."}
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <MetricBlock
          label="Measured system κ"
          sublabel="The engine vs my blind labels on the held-out set"
          kappa={snap.measured_system}
        />
        <MetricBlock
          label="Measured self-drift κ"
          sublabel="Me vs past me, on the same panel, blind"
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
        <p className="mt-2 text-sm text-quiet">
          ContentRX evaluates against {snap.standards_total} standards.
          As a standard collects enough labelled cases, it moves up
          the ladder: every verdict reviewed, then sampled review,
          then no per-verdict review. The per-standard numbers stay
          internal; this page reports the aggregate.
        </p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <LadderCell
            label="Every verdict reviewed"
            count={snap.by_level.robo_labels}
          />
          <LadderCell
            label="Sampled review"
            count={snap.by_level.batch_approval}
          />
          <LadderCell
            label="No per-verdict review"
            count={snap.by_level.autonomous}
          />
        </dl>
        <p className="mt-3 text-xs text-quiet">
          {snap.standards_measured} of {snap.standards_total} standards
          have enough data for a measured κ.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-line-strong bg-overlay p-6">
        <h2 className="text-lg font-semibold">How I measure</h2>
        <p className="mt-2 text-sm text-quiet">
          Each weekday the engine evaluates checks against the
          standards library and the held-out cases I&rsquo;ve blind-
          labelled. The system κ is how often the engine and I agree
          on the same input. The self-drift κ is how often I agree
          with a past version of myself on the same panel. That number
          is the ceiling: the system can&rsquo;t exceed how well I
          agree with me. The 0.90 design target is a stated
          assumption, not a measurement.
        </p>
        <p className="mt-3 text-sm text-quiet">
          Pending cells render as &ldquo;pending&rdquo;: never zero,
          never filled from the design target. Reporting a
          measurement-in-progress honestly is the whole point.
        </p>
        <p className="mt-3 text-sm text-quiet">
          The weekly calibration log below tracks κ movement, drift
          signals, and active refinement candidates.
        </p>
      </section>

      {/* Calibration log. Folded in from the retired /calibration
          page 2026-05-11 per Robo's footer-cleanup pass. Each entry
          links to its raw markdown on GitHub so the public log
          stays auditable without re-implementing per-week routes. */}
      <section className="mt-10" id="calibration-log">
        <h2 className="text-lg font-semibold">Weekly calibration log</h2>
        <p className="mt-2 text-sm text-quiet">
          Every Monday a new entry is generated. Each entry covers
          the previous week&rsquo;s measured κ movement, drift
          signals, override counts, and active refinement
          candidates. The format is templated on purpose. Consistency
          week to week is what makes drift in the writing detectable.
        </p>
        {calibrationEntries.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line-strong bg-raised px-4 py-6 text-center text-sm text-quiet">
            No calibration log entries yet. The Monday cron generator
            publishes new entries as they land.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {calibrationEntries.map((entry) => (
              <li key={entry.week}>
                <a
                  href={`https://github.com/thenewforktimes/contentRX/blob/main/reports/calibration/${entry.filename}`}
                  className="block rounded-lg border border-line bg-raised p-4 transition hover:border-line-strong"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-mono text-base font-semibold">
                      Week {entry.week}
                    </h3>
                    <span className="font-mono text-[10px] text-quiet">
                      {formatIso(entry.modified_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-quiet">
                    {extractHeadline(entry.contents)}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Named-byline. The accuracy methodology is the named-
          author's claim; the byline is the proof. Accuracy
          methodology binds tightly to the named author and earns
          the byline closer. Heavy divider above so the byline reads
          as a distinct section — the architectural punctuation move
          lifted from Ditto / Linear / Vercel. */}
      <div className="mt-16">
        <Divider weight="strong" className="mb-12" />
        <AuthorBlock />
      </div>

      <footer className="mt-12 text-xs text-quiet">
        <p>
          Public snapshot at{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/reports/accuracy/latest.json"
            className="underline underline-offset-2"
          >
            reports/accuracy/latest.json
          </a>
          , generated nightly by the calibration pipeline. The docs
          site picks up the file on next deploy. Schema version{" "}
          <code className="font-mono">{snap.schema_version}</code>.
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
          ? "border-dashed border-line bg-overlay"
          : "border-line bg-raised"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-quiet">
        {label}
      </p>
      <p className="mt-1 text-xs text-quiet">
        {sublabel}
      </p>
      <div className="mt-3">
        {kappa.state === "measured" ? (
          <>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {kappa.value.toFixed(3)}
            </p>
            {isTarget ? (
              <p className="mt-1 text-xs text-quiet">
                Design assumption · stated separately from measurements
              </p>
            ) : (
              <p className="mt-1 text-xs text-quiet tabular-nums">
                95% CI [{kappa.ci_low.toFixed(3)},{" "}
                {kappa.ci_high.toFixed(3)}] · n = {kappa.sample_size}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-mono text-2xl font-semibold text-quiet">
              pending
            </p>
            <p className="mt-1 text-xs text-quiet">{kappa.reason}</p>
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
    <div className="rounded-md border border-line bg-raised px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-quiet">
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

/** Pull a one-line summary from a calibration markdown — the first
 * non-empty non-header line under "## Measured system κ". Falls
 * back to the first non-empty non-header line in the doc. Lifted
 * verbatim from the retired /calibration index page. */
function extractHeadline(md: string): string {
  const lines = md.split("\n");
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("## Measured system κ")) {
      inSection = true;
      continue;
    }
    if (inSection) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      return trimmed.replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
    }
  }
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return "";
}
