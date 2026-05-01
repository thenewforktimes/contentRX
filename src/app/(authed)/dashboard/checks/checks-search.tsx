"use client";

/**
 * Client-side search + verdict filter for /dashboard/checks.
 *
 * The list of recent checks is server-rendered (page.tsx). This island
 * renders the rows + a search input + a verdict-filter pill row, all
 * filtering on the in-memory list. No backend search call — the
 * 100-row page limit means client-side filter is more than fast enough,
 * and it keeps the privacy story tight (text never leaves your device
 * after the initial render).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Pill } from "@/components/ui/pill";

type SegmentType = "standard" | "document" | "surface";

interface CheckHistoryRow {
  id: string;
  createdAt: string;
  source: string | null;
  segmentType: SegmentType;
  unitsConsumed: number;
  verdict: string | null;
  verdictLabel: string;
  violationCount: number;
  contentType: string | null;
  moment: string | null;
  textPreview: string | null;
}

type VerdictFilter = "all" | "violation" | "review_recommended" | "pass";

const VERDICT_LABEL: Record<VerdictFilter, string> = {
  all: "All",
  violation: "Findings",
  review_recommended: "Worth a look",
  pass: "All clear",
};

export function ChecksSearch({ rows }: { rows: CheckHistoryRow[] }) {
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<VerdictFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (verdict !== "all" && r.verdict !== verdict) return false;
      if (q.length === 0) return true;
      return (
        (r.textPreview ?? "").toLowerCase().includes(q) ||
        (r.contentType ?? "").toLowerCase().includes(q) ||
        (r.moment ?? "").toLowerCase().includes(q) ||
        (r.source ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, verdict]);

  const counts = useMemo(() => {
    const out: Record<VerdictFilter, number> = {
      all: rows.length,
      violation: 0,
      review_recommended: 0,
      pass: 0,
    };
    for (const r of rows) {
      if (r.verdict === "violation") out.violation++;
      else if (r.verdict === "review_recommended") out.review_recommended++;
      else out.pass++;
    }
    return out;
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <label
          htmlFor="checks-search"
          className="text-xs font-medium text-stone-700 dark:text-stone-300"
        >
          Search
        </label>
        <input
          id="checks-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a check by text, content type, moment, or source"
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
        />
        <div
          role="radiogroup"
          aria-label="Verdict filter"
          className="flex flex-wrap gap-2 text-xs"
        >
          {(Object.keys(VERDICT_LABEL) as VerdictFilter[]).map((v) => {
            const active = verdict === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setVerdict(v)}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  active
                    ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                    : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                }`}
              >
                {VERDICT_LABEL[v]} · {counts[v]}
              </button>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-stone-500 dark:text-stone-400">
        Showing {filtered.length} of {rows.length} checks.
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-200 p-4 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">
          No checks match the current filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                  <Pill tone={toneFor(row.verdict)}>{row.verdictLabel}</Pill>
                  {row.violationCount > 0 && (
                    <span className="text-stone-700 dark:text-stone-300">
                      {row.violationCount} finding
                      {row.violationCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="text-right text-xs text-stone-500 dark:text-stone-400">
                  <p>{formatRelative(new Date(row.createdAt))}</p>
                  <p>
                    {row.segmentType} · {row.unitsConsumed} unit
                    {row.unitsConsumed === 1 ? "" : "s"}
                    {row.source ? ` · ${row.source}` : ""}
                  </p>
                </div>
              </div>
              {row.textPreview ? (
                <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-stone-800 dark:text-stone-200">
                  {row.textPreview}
                  {row.textPreview.length >= 80 && "…"}
                </p>
              ) : (
                <p className="mt-2 text-xs italic text-stone-500 dark:text-stone-400">
                  Text not retained.
                </p>
              )}
              {(row.contentType || row.moment) && (
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  {row.contentType && <span>{row.contentType}</span>}
                  {row.contentType && row.moment && <span> · </span>}
                  {row.moment && <span>{row.moment}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
        Showing the most recent {rows.length} checks. For runs from the
        GitHub Action,{" "}
        <Link
          href="/dashboard/runs"
          className="underline underline-offset-2"
        >
          run history
        </Link>{" "}
        groups checks by CI run.
      </p>
    </div>
  );
}

function toneFor(
  verdict: string | null,
): "amber" | "red" | "emerald" | "neutral" {
  if (verdict === "violation") return "red";
  if (verdict === "review_recommended") return "amber";
  if (verdict === "pass") return "emerald";
  return "neutral";
}

function formatRelative(date: Date): string {
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
