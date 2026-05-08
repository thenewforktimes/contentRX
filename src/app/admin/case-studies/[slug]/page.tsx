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
import { Pill, type PillTone } from "@/components/ui/pill";
import {
  loadCaseStudyDetail,
  type EngineResultRow,
  type PublicCheckEnvelope,
} from "@/lib/admin-case-studies.server";
import { LogRefinementButton } from "./log-refinement-button";

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
            className="text-quiet hover:underline"
          >
            ← Back to case studies
          </Link>
        </p>
        <h1 className="mt-2 font-mono text-2xl font-semibold text-strong">
          {detail.slug}
        </h1>
        {detail.description && (
          <p className="mt-2 text-sm text-quiet">
            {detail.description}
          </p>
        )}
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-quiet">
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

      <section className="rounded-lg border border-line bg-raised p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
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
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
              Review reasons
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(detail.review_reason_counts)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, n]) => (
                  <Pill
                    key={reason}
                    tone="neutral"
                    size="xs"
                    className="font-mono"
                  >
                    {reason} · {n}
                  </Pill>
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
        <section className="rounded-lg border border-line bg-raised p-4">
          <details>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-quiet">
              Auto-rolled summary
            </summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-default">
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
          className="text-base font-semibold text-strong"
        >
          {VERDICT_LABEL[verdict]}{" "}
          <span className="font-mono text-sm text-quiet">
            ({rows.length})
          </span>
        </h2>
        <p className="mt-1 text-xs text-quiet">
          {VERDICT_DESCRIPTION[verdict]}
        </p>
      </header>
      <ul className="divide-y divide-line rounded-lg border border-line bg-raised">
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
  const verdict = !isError ? (resp as PublicCheckEnvelope).verdict : "error";

  // Surface the inline "log refinement" form on rows worth triaging —
  // anything the engine flagged. Passes don't carry a refinement button
  // because the most common false-negative case is "engine missed
  // something" which doesn't have row-level context to pre-fill from.
  const showLogButton = verdict !== "pass";

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-baseline gap-3">
          <p className="font-sans text-sm text-strong">
            {row.input.text}
          </p>
          {review_reason && (
            <Pill tone="amber" size="xs" className="font-mono">
              {review_reason}
            </Pill>
          )}
        </div>
        {showLogButton && (
          <LogRefinementButton defaults={buildDefaults(row, verdict)} />
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[10px] text-quiet">
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
        <ul className="mt-1 space-y-2 border-l-2 border-line pl-3">
          {violations.map((v, j) => (
            <li key={j} className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <SeverityBadge severity={v.severity} />
                <span className="text-strong">
                  {v.issue}
                </span>
                <span className="font-mono text-[10px] text-quiet">
                  conf {(v.confidence ?? 0).toFixed(2)}
                </span>
              </div>
              {v.suggestion && (
                <p className="text-xs text-quiet">
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

/** Compose the pre-fill values for the inline refinement form from a
 * single engine-result row. The triggering_case is rich enough to
 * stand alone in the refinement log without the founder having to
 * retype source location, head SHA, or the engine verdict; the
 * current_category gets a best-effort hint from the violation's
 * issue text. */
function buildDefaults(
  row: EngineResultRow,
  verdict: string,
): {
  triggering_case: string;
  current_category_hint: string;
  title_hint: string;
} {
  const today = new Date().toISOString().slice(0, 10);
  const isError = "error" in row.response;
  const v0 =
    !isError && (row.response as PublicCheckEnvelope).violations.length > 0
      ? (row.response as PublicCheckEnvelope).violations[0]!
      : null;
  const review_reason = !isError
    ? (row.response as PublicCheckEnvelope).review_reason
    : null;

  // Triggering case prose — same shape we'd write by hand for a
  // refinement candidate. Includes target slug + source location +
  // head SHA + verdict + (when present) issue text.
  const lines: string[] = [];
  lines.push(
    `${row.input.target} case study, ${today}. Engine verdict: \`${verdict}\`${
      review_reason ? ` (\`${review_reason}\`)` : ""
    }.`,
  );
  lines.push(
    `Text: "${row.input.text.slice(0, 240)}"${row.input.text.length > 240 ? "…" : ""}`,
  );
  lines.push(
    `Source: ${row.input.source_file}:${row.input.line} (kind \`${row.input.kind}\`, head ${row.input.head_sha.slice(0, 7)}).`,
  );
  if (v0) {
    lines.push(
      `Engine reported: "${v0.issue}" — suggests "${v0.suggestion}". Severity ${v0.severity}, confidence ${(
        v0.confidence ?? 0
      ).toFixed(2)}.`,
    );
  }
  if (isError) {
    lines.push(
      `Engine errored: ${(row.response as { error: string }).error}.`,
    );
  }

  const triggering_case = lines.join(" ");

  // Best-effort category hint. We don't have standard_id (privacy
  // boundary) so the hint is the issue text itself, which the founder
  // refines. For pass-but-flagged-as-review rows, use the review_reason.
  let current_category_hint = "";
  if (v0) {
    current_category_hint = v0.issue;
  } else if (review_reason) {
    current_category_hint = `review_reason: ${review_reason}`;
  }

  // Title: short truncation of the row text, since the form's optional
  // title is a header for the entry.
  const title_hint =
    row.input.text.length <= 60
      ? row.input.text
      : `${row.input.text.slice(0, 57)}…`;

  return { triggering_case, current_category_hint, title_hint };
}

function SeverityBadge({
  severity,
}: {
  severity: "high" | "medium" | "low";
}) {
  const tone: PillTone =
    severity === "high"
      ? "red"
      : severity === "medium"
        ? "amber"
        : "neutral";
  return (
    <Pill tone={tone} size="xs" className="font-semibold uppercase tracking-wide">
      {severity}
    </Pill>
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
  const pillTone: PillTone =
    tone === "emerald"
      ? "emerald"
      : tone === "amber"
        ? "amber"
        : tone === "rose"
          ? "red"
          : "stone";
  return (
    <Pill tone={pillTone} className="font-mono">
      {n} {label}
    </Pill>
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
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
        {label}
      </dt>
      <dd className={`mt-0.5 ${mono ? "font-mono" : ""} text-default`}>
        {value}
      </dd>
    </div>
  );
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}
