/**
 * `/admin/case-studies/[slug]` — per-target detail.
 *
 * Renders:
 *   - Header with verdict counts + freshness indicators
 *   - Each evaluated string grouped by verdict (review_recommended
 *     and violation first — the rows that actually need attention),
 *     with violations expanded inline
 *   - The hand-written notes.md (when present)
 *   - Raw summary.md collapsed at the bottom for reference
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadCaseStudyDetail,
  type EngineResultRow,
  type PublicCheckEnvelope,
} from "@/lib/admin-case-studies.server";

export const metadata = {
  title: "Case study · ContentRX admin",
  robots: { index: false, follow: false },
};

const VERDICT_ORDER = [
  "review_recommended",
  "violation",
  "error",
  "pass",
] as const;

const VERDICT_LABEL: Record<(typeof VERDICT_ORDER)[number], string> = {
  review_recommended: "Review recommended",
  violation: "Violations",
  error: "Errors",
  pass: "Passed",
};

const VERDICT_DESCRIPTION: Record<(typeof VERDICT_ORDER)[number], string> = {
  review_recommended:
    "Engine flagged but is uncertain. The human read decides whether the moment changes the answer.",
  violation:
    "Engine flagged a clear violation. Where the engine got it right, the standards held; where wrong, it's a refinement-log candidate.",
  error: "The engine errored on this row — usually a quota / network failure during evaluate.",
  pass: "Engine read no issue. Spot-check a few — if any are wrong, those are false negatives worth logging.",
};

export default async function AdminCaseStudyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = loadCaseStudyDetail(decodeURIComponent(slug));
  if (!detail) notFound();

  const grouped: Record<string, EngineResultRow[]> = {
    review_recommended: [],
    violation: [],
    error: [],
    pass: [],
  };
  for (const row of detail.results) {
    const resp = row.response;
    if ("error" in resp) {
      grouped.error!.push(row);
    } else {
      const verdict = resp.verdict;
      if (verdict in grouped) {
        grouped[verdict]!.push(row);
      }
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs">
          <Link
            href="/admin/case-studies"
            className="text-neutral-600 hover:underline dark:text-neutral-400"
          >
            ← Back to case studies
          </Link>
        </p>
        <h1 className="mt-2 font-mono text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {detail.slug}
        </h1>
        {detail.description && (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {detail.description}
          </p>
        )}
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-600 dark:text-neutral-400">
          {detail.repo && (
            <Meta label="Repo" value={detail.repo} mono />
          )}
          {detail.head_sha && (
            <Meta label="HEAD" value={detail.head_sha.slice(0, 12)} mono />
          )}
          <Meta
            label="Strings"
            value={`${detail.extracted_count.toLocaleString()} extracted · ${detail.evaluated_count.toLocaleString()} evaluated`}
          />
          <Meta label="Updated" value={formatDate(detail.modified_at)} mono />
        </dl>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Verdict distribution
        </h2>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <VerdictPill
            label="pass"
            n={detail.verdict_counts.pass}
            tone="emerald"
          />
          <VerdictPill
            label="review"
            n={detail.verdict_counts.review_recommended}
            tone="amber"
          />
          <VerdictPill
            label="violation"
            n={detail.verdict_counts.violation}
            tone="rose"
          />
          {detail.verdict_counts.error > 0 && (
            <VerdictPill
              label="error"
              n={detail.verdict_counts.error}
              tone="muted"
            />
          )}
        </div>
        {Object.keys(detail.review_reason_counts).length > 0 && (
          <div className="mt-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Review reasons
            </h3>
            <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px]">
              {Object.entries(detail.review_reason_counts)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, n]) => (
                  <span
                    key={reason}
                    className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    {reason} · {n}
                  </span>
                ))}
            </div>
          </div>
        )}
      </section>

      {detail.notes_md && (
        <section
          aria-labelledby="notes-heading"
          className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"
        >
          <h2
            id="notes-heading"
            className="text-sm font-semibold text-emerald-900 dark:text-emerald-200"
          >
            Hand-written notes
          </h2>
          <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
            From{" "}
            <code className="font-mono">
              evals/case-studies/{detail.slug}/notes.md
            </code>
          </p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
{detail.notes_md}
          </pre>
        </section>
      )}

      {VERDICT_ORDER.map((verdict) => {
        const rows = grouped[verdict] ?? [];
        if (rows.length === 0) return null;
        return (
          <ResultsSection
            key={verdict}
            verdict={verdict}
            rows={rows}
          />
        );
      })}

      {detail.summary_md && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <details>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Auto-rolled summary
            </summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
{detail.summary_md}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}

function ResultsSection({
  verdict,
  rows,
}: {
  verdict: (typeof VERDICT_ORDER)[number];
  rows: EngineResultRow[];
}) {
  return (
    <section
      aria-labelledby={`section-${verdict}`}
      className="space-y-3"
    >
      <header>
        <h2
          id={`section-${verdict}`}
          className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
        >
          {VERDICT_LABEL[verdict]}{" "}
          <span className="font-mono text-sm text-neutral-500">
            ({rows.length})
          </span>
        </h2>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          {VERDICT_DESCRIPTION[verdict]}
        </p>
      </header>
      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {rows.map((row, i) => (
          <ResultRow key={`${row.input.source_file}:${row.input.line}:${i}`} row={row} />
        ))}
      </ul>
    </section>
  );
}

function ResultRow({ row }: { row: EngineResultRow }) {
  const resp = row.response;
  const isError = "error" in resp;
  const violations = !isError ? (resp as PublicCheckEnvelope).violations : [];
  const review_reason = !isError
    ? (resp as PublicCheckEnvelope).review_reason
    : null;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="font-sans text-sm text-neutral-900 dark:text-neutral-100">
          {row.input.text}
        </p>
        {review_reason && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {review_reason}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[10px] text-neutral-500">
        <span>{row.input.kind}</span>
        <span>{row.input.source_file}:{row.input.line}</span>
        {row.elapsed_ms !== undefined && <span>{row.elapsed_ms}ms</span>}
      </div>
      {isError && (
        <p className="font-mono text-[11px] text-rose-700 dark:text-rose-300">
          error: {(resp as { error: string }).error}
        </p>
      )}
      {violations.length > 0 && (
        <ul className="mt-1 space-y-2 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
          {violations.map((v, j) => (
            <li key={j} className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <SeverityBadge severity={v.severity} />
                <span className="text-neutral-900 dark:text-neutral-100">
                  {v.issue}
                </span>
                <span className="font-mono text-[10px] text-neutral-500">
                  conf {(v.confidence ?? 0).toFixed(2)}
                </span>
              </div>
              {v.suggestion && (
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  → {v.suggestion}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: "high" | "medium" | "low";
}) {
  const cls =
    severity === "high"
      ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
      : severity === "medium"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${cls}`}
    >
      {severity}
    </span>
  );
}

function VerdictPill({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone: "emerald" | "amber" | "rose" | "muted";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : tone === "amber"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : tone === "rose"
      ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500";
  return (
    <span className={`rounded-full px-3 py-1 font-mono text-xs ${cls}`}>
      {n} {label}
    </span>
  );
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className={`mt-0.5 ${mono ? "font-mono" : ""} text-neutral-800 dark:text-neutral-200`}>
        {value}
      </dd>
    </div>
  );
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}
