"use client";

/**
 * URL-driven search island for /dashboard/checks.
 *
 * The page is server-rendered; this component owns the controls
 * (text input + verdict filter pills + pagination) and updates the
 * URL via router.push. Every change triggers a server re-render with
 * the new ?q / ?verdict / ?page values, so search hits the entire
 * history (not just the most-recent-100 client-side window the page
 * used to use).
 *
 * Text input is debounced at 280ms — slow enough to avoid a fetch
 * per keystroke, fast enough that the customer sees results land
 * before they decide whether to refine.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { humanizeContentType, humanizeMoment } from "@/lib/humanize";

// Includes legacy three-tier values for historical rows that pre-date
// schema 3.0.0; new rows always write "small" or "large". The label
// itself is no longer rendered to customers. The page-level loader
// coerces legacy rows ("standard" / "document" / "surface") to
// "large" before they reach this component, so the type can be
// the narrow post-3.0.0 union.
type SegmentType = "small" | "large";

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

type VerdictFilter = "" | "violation" | "review_recommended" | "pass";

const VERDICT_LABEL: Record<string, string> = {
  "": "All",
  violation: "Findings",
  review_recommended: "Worth a look",
  pass: "All clear",
};

const VERDICT_KEYS: VerdictFilter[] = [
  "",
  "violation",
  "review_recommended",
  "pass",
];

interface ChecksSearchProps {
  rows: CheckHistoryRow[];
  query: string;
  verdict: string;
  page: number;
  hasMore: boolean;
  counts: Record<string, number>;
}

const DEBOUNCE_MS = 280;

export function ChecksSearch({
  rows,
  query,
  verdict,
  page,
  hasMore,
  counts,
}: ChecksSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Local input state so typing feels instant while the actual query
  // debounces to a router.push.
  const [localQuery, setLocalQuery] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync local state when the URL changes externally (e.g. clicking
  // a verdict pill should preserve the search input value, but the
  // back button should restore the prior query).
  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  const buildUrl = useCallback(
    (overrides: { q?: string; verdict?: string; page?: number }) => {
      const next = new URLSearchParams(searchParams.toString());
      if (overrides.q !== undefined) {
        if (overrides.q.length === 0) next.delete("q");
        else next.set("q", overrides.q);
      }
      if (overrides.verdict !== undefined) {
        if (overrides.verdict.length === 0) next.delete("verdict");
        else next.set("verdict", overrides.verdict);
      }
      // Any control change resets pagination unless explicitly set.
      if (overrides.page !== undefined) {
        if (overrides.page <= 1) next.delete("page");
        else next.set("page", String(overrides.page));
      } else {
        next.delete("page");
      }
      const qs = next.toString();
      return qs.length > 0 ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const onQueryChange = useCallback(
    (value: string) => {
      setLocalQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.push(buildUrl({ q: value }));
      }, DEBOUNCE_MS);
    },
    [router, buildUrl],
  );

  const onVerdictChange = useCallback(
    (next: VerdictFilter) => {
      router.push(buildUrl({ verdict: next }));
    },
    [router, buildUrl],
  );

  const summary = useMemo(() => {
    if (query.length > 0 && verdict.length > 0) {
      return `${rows.length} match${rows.length === 1 ? "" : "es"} for "${query}" with the ${VERDICT_LABEL[verdict]} filter on.`;
    }
    if (query.length > 0) {
      return `${rows.length} match${rows.length === 1 ? "" : "es"} for "${query}".`;
    }
    if (verdict.length > 0) {
      return `${rows.length} ${VERDICT_LABEL[verdict].toLowerCase()} on this page.`;
    }
    return `${rows.length} most recent.`;
  }, [rows.length, query, verdict]);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <label
          htmlFor="checks-search"
          className="text-xs font-medium text-default"
        >
          Search across every check
        </label>
        <Input
          id="checks-search"
          type="text"
          value={localQuery}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Try a phrase you remember writing"
          autoComplete="off"
          className="text-base"
        />
        <p className="text-xs text-quiet">
          Substring match against the text you checked, plus the content
          type, moment, and source. Even a few words will find it.
        </p>
        <div
          role="radiogroup"
          aria-label="Verdict filter"
          className="mt-1 flex flex-wrap gap-2 text-xs"
        >
          {VERDICT_KEYS.map((v) => {
            const active = verdict === v;
            return (
              <button
                key={v || "all"}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onVerdictChange(v)}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  active
                    ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                    : "bg-sunken text-default hover:bg-hover"
                }`}
              >
                {VERDICT_LABEL[v]} · {counts[v || "all"] ?? 0}
              </button>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-quiet">{summary}</p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-quiet">
          {query.length > 0
            ? `No checks match "${query}". Try fewer words, or clear the filter pill above.`
            : "No checks match the current filter."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-line bg-raised p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-quiet">
                  <Pill tone={toneFor(row.verdict)}>{row.verdictLabel}</Pill>
                  {row.violationCount > 0 && (
                    <span className="text-default">
                      {row.violationCount} finding
                      {row.violationCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="text-right text-xs text-quiet">
                  <p>{formatRelative(new Date(row.createdAt))}</p>
                  <p>
                    {row.unitsConsumed} unit
                    {row.unitsConsumed === 1 ? "" : "s"}
                    {row.source ? ` · ${row.source}` : ""}
                  </p>
                </div>
              </div>
              {row.textPreview ? (
                <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-default">
                  {row.textPreview}
                  {row.textPreview.length >= 80 && "…"}
                </p>
              ) : (
                <p className="mt-2 text-xs italic text-quiet">
                  Text not retained.
                </p>
              )}
              {(row.contentType || row.moment) && (
                <p className="mt-1 text-xs text-quiet">
                  {row.contentType && (
                    <span>{humanizeContentType(row.contentType)}</span>
                  )}
                  {row.contentType && row.moment && <span> · </span>}
                  {row.moment && <span>{humanizeMoment(row.moment)}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || hasMore) && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3 pt-2 text-sm"
        >
          {page > 1 ? (
            <Link
              href={buildPaginationHref(searchParams, pathname, page - 1)}
              className="text-quiet underline underline-offset-2 hover:text-strong"
            >
              ← Newer
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="text-xs text-quiet">
            Page {page}
          </span>
          {hasMore ? (
            <Link
              href={buildPaginationHref(searchParams, pathname, page + 1)}
              className="text-quiet underline underline-offset-2 hover:text-strong"
            >
              Older →
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      )}

      <p className="mt-2 text-xs text-quiet">
        For runs from the GitHub Action,{" "}
        <Link href="/dashboard/runs" className="underline underline-offset-2">
          run history
        </Link>{" "}
        groups checks by CI run.
      </p>
    </div>
  );
}

function buildPaginationHref(
  searchParams: ReturnType<typeof useSearchParams>,
  pathname: string,
  nextPage: number,
): string {
  const next = new URLSearchParams(searchParams.toString());
  if (nextPage <= 1) next.delete("page");
  else next.set("page", String(nextPage));
  const qs = next.toString();
  return qs.length > 0 ? `${pathname}?${qs}` : pathname;
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
