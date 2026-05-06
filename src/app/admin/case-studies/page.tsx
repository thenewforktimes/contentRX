/**
 * `/admin/case-studies` — index of OSS product case studies.
 *
 * Reads the artifacts written by `tools/case_study.py` from
 * `evals/case-studies/<slug>/`. Each row links to the per-target
 * detail view. Empty state explains the workflow when no studies
 * exist yet.
 *
 * Auth handled by `src/app/admin/layout.tsx` (founder gate).
 */

import Link from "next/link";
import { Pill, type PillTone } from "@/components/ui/pill";
import {
  listCaseStudies,
  type CaseStudySummary,
} from "@/lib/admin-case-studies.server";

export const metadata = {
  title: "Case studies · ContentRX admin",
  robots: { index: false, follow: false },
};

export default function AdminCaseStudiesPage() {
  const studies = listCaseStudies();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-strong">
          Case studies
        </h1>
        <p className="mt-1 text-sm text-quiet">
          OSS product case studies — what the engine sees on real
          products, where it agrees with human judgment, where it
          doesn&apos;t. Working substrate; the published artifacts at
          <code className="mx-1 font-mono text-xs">
            docs-site/content/case-studies/
          </code>
          ship only after the target&apos;s maintainers approve.
        </p>
      </header>

      {studies.length === 0 ? <EmptyState /> : <StudiesList studies={studies} />}

      <section className="rounded-md border border-line bg-raised p-5 text-xs">
        <h2 className="text-sm font-semibold text-strong">
          Workflow
        </h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-default">
          <li>
            <span className="font-mono">
              python3 tools/case_study.py crawl --slug &lt;slug&gt; --repo
              &lt;url&gt;
            </span>
            {" "}— clones target, extracts strings, writes
            <code className="mx-1 font-mono">extracted_strings.jsonl</code>.
          </li>
          <li>
            <span className="font-mono">
              python3 tools/case_study.py evaluate --slug &lt;slug&gt; --limit
              25
            </span>
            {" "}— runs each string through the engine, writes
            <code className="mx-1 font-mono">engine_results.jsonl</code>.
          </li>
          <li>
            <span className="font-mono">
              python3 tools/case_study.py summarize --slug &lt;slug&gt;
            </span>
            {" "}— produces
            <code className="mx-1 font-mono">summary.md</code>.
          </li>
          <li>
            Commit the artifacts. Vercel redeploys; this page refreshes.
          </li>
        </ol>
        <p className="mt-3 text-quiet">
          Vercel runtime is read-only — the loop runs locally on your
          checkout, the artifacts ship via git.
        </p>
      </section>
    </div>
  );
}

function StudiesList({ studies }: { studies: CaseStudySummary[] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-raised">
      {studies.map((s) => (
        <StudyRow key={s.slug} study={s} />
      ))}
    </ul>
  );
}

function StudyRow({ study }: { study: CaseStudySummary }) {
  const interesting =
    study.verdict_counts.violation +
    study.verdict_counts.review_recommended;
  const interestingRate =
    study.evaluated_count > 0
      ? Math.round((interesting / study.evaluated_count) * 100)
      : 0;

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-4">
      <div className="flex flex-1 flex-col gap-1 min-w-[260px]">
        <Link
          href={`/admin/case-studies/${encodeURIComponent(study.slug)}`}
          className="font-mono text-sm font-semibold text-strong hover:underline"
        >
          {study.slug}
        </Link>
        {study.description && (
          <p className="text-xs text-quiet line-clamp-2">
            {study.description}
          </p>
        )}
        <div className="flex flex-wrap items-baseline gap-3 text-[10px] text-quiet">
          {study.repo && (
            <span className="font-mono">
              {study.repo.replace(/^https?:\/\//, "")}
            </span>
          )}
          {study.head_sha && (
            <span className="font-mono">{study.head_sha.slice(0, 7)}</span>
          )}
          <span>updated {formatDate(study.modified_at)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-3 font-mono text-[10px]">
        <Counter label="strings" value={study.extracted_count} tone="neutral" />
        <Counter
          label="evaluated"
          value={study.evaluated_count}
          tone={study.evaluated_count > 0 ? "neutral" : "muted"}
        />
        {study.evaluated_count > 0 && (
          <>
            <Counter
              label="pass"
              value={study.verdict_counts.pass}
              tone="emerald"
            />
            <Counter
              label="review"
              value={study.verdict_counts.review_recommended}
              tone="amber"
            />
            <Counter
              label="violation"
              value={study.verdict_counts.violation}
              tone="rose"
            />
            {study.error_count > 0 && (
              <Counter
                label="error"
                value={study.error_count}
                tone="muted"
              />
            )}
            <Pill tone="neutral">{interestingRate}% non-pass</Pill>
          </>
        )}
      </div>
    </li>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "neutral" | "muted";
}) {
  const pillTone: PillTone =
    tone === "emerald"
      ? "emerald"
      : tone === "amber"
        ? "amber"
        : tone === "rose"
          ? "red"
          : tone === "muted"
            ? "stone"
            : "neutral";
  return (
    <Pill tone={pillTone}>
      {value} {label}
    </Pill>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-raised px-6 py-10 text-center">
      <p className="text-sm font-semibold text-strong">
        No case studies yet.
      </p>
      <p className="mt-2 text-xs text-quiet">
        Run the workflow below from a local checkout to seed the first
        target. Artifacts under{" "}
        <code className="font-mono">evals/case-studies/&lt;slug&gt;/</code>
        {" "}land here automatically once committed.
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}
