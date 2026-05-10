"use client";

/**
 * URL-driven browse + filter island for /dashboard/checks.
 *
 * The page is server-rendered; this component owns the controls and
 * updates the URL via router.push. Every change triggers a server
 * re-render with the new params.
 *
 * URL params:
 *   - ?q=<text>        search substring
 *   - ?verdict=<one>   verdict filter
 *   - ?source=<one>    surface filter (dashboard / plugin / cli / action / lsp / mcp)
 *   - ?filter=flagged  scope to checks the signed-in user shared via Flag for Review
 *   - ?range=<one>     day | week | month | 30d | all
 *   - ?from=<iso>      custom start date (overrides ?range)
 *   - ?to=<iso>        custom end date (overrides ?range)
 *   - ?page=<n>        pagination
 *
 * Why so many filters: the dashboard is the customer's home base.
 * Robert's six jobs-to-be-done (browse, find, flag, revoke, time-
 * slice, surface-attribute) each need one control. They share the URL
 * so any view is shareable / bookmarkable.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlagForReview } from "@/components/flag-for-review";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import {
  humanizeChecks,
  humanizeContentType,
  humanizeMoment,
} from "@/lib/humanize";
import { RevokeButton } from "../shared/revoke-button";
import type { CheckHistoryRow } from "./page";

type DateRange = "day" | "week" | "month" | "30d" | "all";

const RANGE_LABEL: Record<DateRange, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  "30d": "Last 30 days",
  all: "All time",
};

const RANGE_KEYS: DateRange[] = ["day", "week", "month", "30d", "all"];

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

const SOURCE_LABEL: Record<string, string> = {
  dashboard: "Paste panel",
  plugin: "Figma plugin",
  cli: "CLI",
  action: "GitHub Action",
  lsp: "Editor (LSP)",
  mcp: "Claude / Cursor",
  ditto: "Ditto",
};

interface ChecksSearchProps {
  rows: CheckHistoryRow[];
  query: string;
  verdict: string;
  source: string;
  flaggedOnly: boolean;
  range: DateRange;
  customFrom: string;
  customTo: string;
  page: number;
  hasMore: boolean;
  counts: Record<string, number>;
  flaggedCount: number;
  sourcesPresent: string[];
}

const DEBOUNCE_MS = 280;

export function ChecksSearch({
  rows,
  query,
  verdict,
  source,
  flaggedOnly,
  range,
  customFrom,
  customTo,
  page,
  hasMore,
  counts,
  flaggedCount,
  sourcesPresent,
}: ChecksSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localQuery, setLocalQuery] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [customOpen, setCustomOpen] = useState(
    customFrom.length > 0 || customTo.length > 0,
  );

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  const buildUrl = useCallback(
    (overrides: {
      q?: string;
      verdict?: string;
      source?: string;
      filter?: string | null;
      // "" clears the range param so a custom date range can take over.
      range?: DateRange | "";
      from?: string;
      to?: string;
      page?: number;
    }) => {
      const next = new URLSearchParams(searchParams.toString());
      const setOrClear = (key: string, value: string | undefined) => {
        if (value === undefined) return;
        if (value.length === 0) next.delete(key);
        else next.set(key, value);
      };
      setOrClear("q", overrides.q);
      setOrClear("verdict", overrides.verdict);
      setOrClear("source", overrides.source);
      // ?filter=flagged is a presence-only key. Passing null clears.
      if (overrides.filter !== undefined) {
        if (overrides.filter === null) next.delete("filter");
        else next.set("filter", overrides.filter);
      }
      setOrClear("range", overrides.range);
      setOrClear("from", overrides.from);
      setOrClear("to", overrides.to);
      // Any control change resets pagination unless explicit.
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

  const onRangeChange = useCallback(
    (next: DateRange) => {
      // Selecting a named range clears any ?from/?to override.
      router.push(buildUrl({ range: next, from: "", to: "" }));
      setCustomOpen(false);
    },
    [router, buildUrl],
  );

  const onCustomRange = useCallback(
    (from: string, to: string) => {
      router.push(buildUrl({ from, to, range: "" }));
    },
    [router, buildUrl],
  );

  const onVerdictChange = useCallback(
    (next: VerdictFilter) => {
      router.push(buildUrl({ verdict: next }));
    },
    [router, buildUrl],
  );

  const onSourceChange = useCallback(
    (next: string) => {
      router.push(buildUrl({ source: next }));
    },
    [router, buildUrl],
  );

  const onFlaggedToggle = useCallback(() => {
    router.push(buildUrl({ filter: flaggedOnly ? null : "flagged" }));
  }, [router, buildUrl, flaggedOnly]);

  const totalChecks = counts.all;
  const totalFindings = counts.violation;

  // Caption text describes the active filter shape. The "Shared for
  // review" caption explicitly names /dashboard/shared as the
  // canonical privacy mirror so the relationship between the two
  // surfaces is discoverable without hover.
  const caption = useMemo(() => {
    const windowLabel =
      customFrom || customTo
        ? `${customFrom || "..."} → ${customTo || "..."}`
        : RANGE_LABEL[range].toLowerCase();
    if (flaggedOnly) {
      return (
        <>
          Showing checks you shared via Flag for Review,{" "}
          {windowLabel}. The full list lives at{" "}
          <Link
            href="/dashboard/shared"
            className="underline underline-offset-2"
          >
            /dashboard/shared
          </Link>
          .
        </>
      );
    }
    const verdictPart =
      verdict.length > 0
        ? ` filtered to ${VERDICT_LABEL[verdict].toLowerCase()}`
        : "";
    const sourcePart =
      source.length > 0 ? ` from ${SOURCE_LABEL[source] ?? source}` : "";
    return `Showing checks ${windowLabel}${verdictPart}${sourcePart}.`;
  }, [flaggedOnly, range, customFrom, customTo, verdict, source]);

  // Group rows by ISO date (yyyy-mm-dd). The query is already sorted
  // DESC by created_at, so each group's order is preserved as we
  // walk it.
  const grouped = useMemo(() => {
    const groups = new Map<string, CheckHistoryRow[]>();
    for (const row of rows) {
      const key = row.createdAt.slice(0, 10);
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    return Array.from(groups.entries());
  }, [rows]);

  const usingCustomRange = customFrom.length > 0 || customTo.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ──────────────── Time-window chips ──────────────── */}
      <section
        role="radiogroup"
        aria-label="Time window"
        className="flex flex-wrap gap-2 text-xs"
      >
        {RANGE_KEYS.map((r) => {
          const active = !usingCustomRange && range === r;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onRangeChange(r)}
              className={chipClass(active)}
            >
              {RANGE_LABEL[r]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustomOpen((open) => !open)}
          aria-expanded={customOpen}
          className={chipClass(usingCustomRange)}
        >
          {usingCustomRange
            ? `Custom: ${customFrom || "..."} → ${customTo || "..."}`
            : "Custom…"}
        </button>
      </section>

      {customOpen && (
        <CustomRangeInputs
          initialFrom={customFrom}
          initialTo={customTo}
          onApply={onCustomRange}
        />
      )}

      {/* ──────────────── Stats strip ──────────────── */}
      <section
        aria-label="Summary stats"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-overlay px-3 py-2 text-xs text-default"
      >
        <span>
          <span className="font-medium text-strong">{totalChecks}</span>{" "}
          {humanizeChecks(totalChecks)}
        </span>
        <span>
          <span className="font-medium text-strong">{totalFindings}</span>{" "}
          {totalFindings === 1 ? "finding" : "findings"}
        </span>
        <span>
          <span className="font-medium text-strong">{flaggedCount}</span>{" "}
          shared for review
        </span>
        <span>
          <span className="font-medium text-strong">
            {sourcesPresent.length}
          </span>{" "}
          {sourcesPresent.length === 1 ? "surface" : "surfaces"}
        </span>
      </section>

      {/* ──────────────── Search ──────────────── */}
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
      </section>

      {/* ──────────────── Filter row ──────────────── */}
      <section className="flex flex-wrap items-center gap-2 text-xs">
        <div
          role="radiogroup"
          aria-label="Verdict filter"
          className="flex flex-wrap gap-2"
        >
          {VERDICT_KEYS.map((v) => {
            const active = !flaggedOnly && verdict === v;
            return (
              <button
                key={v || "all"}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onVerdictChange(v)}
                className={chipClass(active)}
                disabled={flaggedOnly}
              >
                {VERDICT_LABEL[v]} · {counts[v || "all"] ?? 0}
              </button>
            );
          })}
        </div>
        <span aria-hidden="true" className="text-quiet">
          ·
        </span>
        <button
          type="button"
          onClick={onFlaggedToggle}
          aria-pressed={flaggedOnly}
          className={chipClass(flaggedOnly)}
        >
          Shared for review · {flaggedCount}
        </button>
        {sourcesPresent.length > 1 && (
          <>
            <span aria-hidden="true" className="text-quiet">
              ·
            </span>
            <label className="flex items-center gap-2">
              <span className="sr-only">Source filter</span>
              <select
                value={source}
                onChange={(e) => onSourceChange(e.target.value)}
                className="rounded-md border border-line-strong bg-raised px-2 py-1 text-xs text-default"
              >
                <option value="">All surfaces</option>
                {sourcesPresent.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s] ?? s}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </section>

      <p className="text-xs text-default">{caption}</p>

      {/* ──────────────── List ──────────────── */}
      {rows.length === 0 ? (
        <EmptyState
          flaggedOnly={flaggedOnly}
          hasQuery={query.length > 0}
          totalChecks={totalChecks}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([day, dayRows], index) => (
            <DayGroup
              key={day}
              day={day}
              rows={dayRows}
              defaultOpen={index < 2}
            />
          ))}
        </div>
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
          <span className="text-xs text-quiet">Page {page}</span>
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
        Every check from every connected surface (paste panel, Figma
        plugin, CLI, GitHub Action, editor LSP, MCP) lands here. If
        you don&apos;t see a check from a specific surface, the auth
        on that surface may not match this account.
      </p>
    </div>
  );
}

function chipClass(active: boolean): string {
  return active
    ? "rounded-full bg-stone-900 px-3 py-1 font-medium text-white dark:bg-stone-100 dark:text-stone-900"
    : "rounded-full bg-sunken px-3 py-1 font-medium text-default transition hover:bg-hover disabled:opacity-50 disabled:hover:bg-sunken";
}

function CustomRangeInputs({
  initialFrom,
  initialTo,
  onApply,
}: {
  initialFrom: string;
  initialTo: string;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  return (
    <section
      aria-label="Custom date range"
      className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-raised px-3 py-2 text-xs"
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium text-default">From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-line-strong bg-canvas px-2 py-1 text-strong"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-default">To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-line-strong bg-canvas px-2 py-1 text-strong"
        />
      </label>
      <button
        type="button"
        onClick={() => onApply(from, to)}
        className="rounded-md bg-stone-900 px-3 py-1 font-medium text-white dark:bg-stone-100 dark:text-stone-900"
      >
        Apply range
      </button>
    </section>
  );
}

function EmptyState({
  flaggedOnly,
  hasQuery,
  totalChecks,
}: {
  flaggedOnly: boolean;
  hasQuery: boolean;
  totalChecks: number;
}) {
  if (flaggedOnly) {
    return (
      <p className="rounded-lg border border-dashed border-line p-4 text-sm text-default">
        No shared-for-review checks in this window. Your full Shared
        checks list lives at{" "}
        <Link
          href="/dashboard/shared"
          className="underline underline-offset-2"
        >
          /dashboard/shared
        </Link>
        .
      </p>
    );
  }
  if (hasQuery) {
    return (
      <p className="rounded-lg border border-dashed border-line p-4 text-sm text-quiet">
        No checks match the search. Try fewer words, or widen the time
        window above.
      </p>
    );
  }
  if (totalChecks === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line p-4 text-sm text-default">
        No checks in this window. Try a wider time range, or run a
        check from any connected surface. They all report here.
      </p>
    );
  }
  return (
    <p className="rounded-lg border border-dashed border-line p-4 text-sm text-quiet">
      No checks match the current filter. Clear a filter pill above to
      see more.
    </p>
  );
}

function DayGroup({
  day,
  rows,
  defaultOpen,
}: {
  day: string;
  rows: CheckHistoryRow[];
  defaultOpen: boolean;
}) {
  const findingsInDay = rows.reduce(
    (n, r) => n + (r.violationCount ?? 0),
    0,
  );
  const flaggedInDay = rows.reduce((n, r) => n + (r.flagged ? 1 : 0), 0);
  const dayHeader = formatDayHeader(day);
  return (
    <details
      open={defaultOpen}
      className="rounded-lg border border-line bg-raised"
    >
      <summary className="cursor-pointer list-none px-4 py-3">
        <span className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-strong">{dayHeader}</span>
          <span className="text-xs text-quiet">
            {rows.length} {humanizeChecks(rows.length)}
            {findingsInDay > 0 && (
              <>
                {" · "}
                {findingsInDay} finding{findingsInDay === 1 ? "" : "s"}
              </>
            )}
            {flaggedInDay > 0 && (
              <>
                {" · "}
                {flaggedInDay} shared
              </>
            )}
          </span>
        </span>
      </summary>
      <ul className="flex flex-col gap-2 border-t border-line px-4 py-3">
        {rows.map((row) => (
          <CheckRow key={row.id} row={row} />
        ))}
      </ul>
    </details>
  );
}

function CheckRow({ row }: { row: CheckHistoryRow }) {
  const sourceLabel = row.source ? SOURCE_LABEL[row.source] ?? row.source : null;
  return (
    <li className="rounded-md border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-quiet">
          <Pill tone={toneFor(row.verdict)}>{row.verdictLabel}</Pill>
          {row.violationCount > 0 && (
            <span className="text-default">
              {row.violationCount} finding
              {row.violationCount === 1 ? "" : "s"}
            </span>
          )}
          {sourceLabel && <Pill tone="neutral">{sourceLabel}</Pill>}
          {row.flagged && (
            <Pill tone="emerald">Shared for review</Pill>
          )}
        </div>
        <div className="text-right text-xs text-quiet">
          <p>{formatRelative(new Date(row.createdAt))}</p>
          <p>
            {row.unitsConsumed} {humanizeChecks(row.unitsConsumed)}
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
          Text not retained past 90 days. Flag from a fresh check if
          this one matters.
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
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {row.flagged && row.flagId ? (
          <RevokeButton id={row.flagId} />
        ) : row.textPreview ? (
          <FlagForReview
            text={row.textPreview}
            contentType={row.contentType}
            moment={row.moment}
            verdict={normalizeVerdict(row.verdict)}
            variant="card-action"
            source="dashboard"
          />
        ) : null}
      </div>
    </li>
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

function normalizeVerdict(
  verdict: string | null,
): "pass" | "violation" | "review_recommended" | null {
  if (
    verdict === "pass" ||
    verdict === "violation" ||
    verdict === "review_recommended"
  ) {
    return verdict;
  }
  return null;
}

function formatDayHeader(iso: string): string {
  // iso is yyyy-mm-dd. Add midday so the Date constructor doesn't pick
  // the previous day in negative-offset timezones.
  const d = new Date(`${iso}T12:00:00.000Z`);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const isSameDay = (a: Date, b: Date) =>
    a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function formatRelative(date: Date): string {
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
