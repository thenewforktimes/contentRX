"use client";

/**
 * URL-driven browse + filter island for /dashboard/checks.
 *
 * Round 2 (2026-05-10): the page reads search-first per Robert's
 * call. Search up top, then time chips, then filter pills (verdict
 * + Shared toggle + surface pills with icons), then a one-line
 * stats caption, then the day-grouped list.
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
 * Per-row layout: verdict chip with finding count baked in on the
 * top line, secondary metadata line below (source · content-type
 * · moment · units), text preview, findings list (issue + suggestion
 * per finding when present), Flag-for-review or Remove-this-check
 * CTA on its own line.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlagForReview } from "@/components/flag-for-review";
import { Button, buttonStyles } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import {
  CliIcon,
  GitHubIcon,
  McpIcon,
  PasteModeIcon,
  VsCodeIcon,
} from "@/components/surface-icons";
import {
  humanizeChecks,
  humanizeContentType,
  humanizeMoment,
} from "@/lib/humanize";
import { RevokeButton } from "../shared/revoke-button";
import type { CheckHistoryRow, CheckHistoryFinding } from "./page";

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
  dashboard: "Web app",
  cli: "CLI",
  action: "GitHub Action",
  lsp: "Editor (LSP)",
  mcp: "Claude / Cursor",
};

// Surface pill order. Matches the surfaces-grid order on the
// landing page so the customer's mental map across product
// surfaces stays consistent.
const SURFACE_ORDER: ReadonlyArray<{
  key: string;
  label: string;
  Glyph: React.ComponentType<{ className?: string }>;
}> = [
  { key: "dashboard", label: "Paste", Glyph: PasteModeIcon },
  { key: "mcp", label: "Claude / Cursor", Glyph: McpIcon },
  { key: "action", label: "GitHub Action", Glyph: GitHubIcon },
  { key: "cli", label: "CLI", Glyph: CliIcon },
  { key: "lsp", label: "Editor", Glyph: VsCodeIcon },
];

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
      if (overrides.filter !== undefined) {
        if (overrides.filter === null) next.delete("filter");
        else next.set("filter", overrides.filter);
      }
      setOrClear("range", overrides.range);
      setOrClear("from", overrides.from);
      setOrClear("to", overrides.to);
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

  const onSourceToggle = useCallback(
    (next: string) => {
      // Clicking the active source clears the filter. Clicking another
      // pill switches to it. Single-select keeps the URL clean.
      router.push(buildUrl({ source: source === next ? "" : next }));
    },
    [router, buildUrl, source],
  );

  const onFlaggedToggle = useCallback(() => {
    router.push(buildUrl({ filter: flaggedOnly ? null : "flagged" }));
  }, [router, buildUrl, flaggedOnly]);

  const totalChecks = counts.all;
  const totalFindings = counts.violation;

  const captionWindow =
    customFrom || customTo
      ? `${customFrom || "..."} → ${customTo || "..."}`
      : RANGE_LABEL[range].toLowerCase();

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

      {/* ──────────────── Verdict + Shared filter row ──────────────── */}
      <section
        aria-label="Filter by verdict and review status"
        className="flex flex-wrap items-center gap-2 text-xs"
      >
        <span className="text-xs text-quiet">Verdict</span>
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
        <button
          type="button"
          onClick={onFlaggedToggle}
          aria-pressed={flaggedOnly}
          className={chipClass(flaggedOnly)}
        >
          Shared for review · {flaggedCount}
        </button>
      </section>

      {/* ──────────────── Surface filter pills ──────────────── */}
      {sourcesPresent.length > 1 && (
        <section
          aria-label="Filter by surface"
          className="flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="text-xs text-quiet">Surface</span>
          {SURFACE_ORDER.filter((s) => sourcesPresent.includes(s.key)).map(
            (s) => {
              const active = source === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onSourceToggle(s.key)}
                  aria-pressed={active}
                  className={`${chipClass(active)} inline-flex items-center gap-1.5`}
                >
                  <s.Glyph className="h-3.5 w-3.5" />
                  <span>{s.label}</span>
                </button>
              );
            },
          )}
        </section>
      )}

      {/* ──────────────── Caption + inline stats ──────────────── */}
      <CaptionLine
        flaggedOnly={flaggedOnly}
        captionWindow={captionWindow}
        verdict={verdict}
        source={source}
        totalChecks={totalChecks}
        totalFindings={totalFindings}
        flaggedCount={flaggedCount}
        sourcesPresent={sourcesPresent}
      />

      {/* ──────────────── List ──────────────── */}
      {rows.length === 0 ? (
        <EmptyState
          flaggedOnly={flaggedOnly}
          hasQuery={query.length > 0}
          totalChecks={totalChecks}
          // pathname (without params) is the reset URL — EmptyState
          // renders a "Clear filters" Link for variants where a
          // filter-narrowed result set is empty. Caught by the
          // affordance audit: variants 2 + 4 told the user what was
          // wrong but offered no path forward in the UI.
          clearAllUrl={pathname}
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
        Every check from every connected surface (web app, MCP,
        GitHub Action, CLI, editor LSP) lands here. If
        you don&apos;t see a check from a specific surface, the auth
        on that surface may not match this account.
      </p>
    </div>
  );
}

function chipClass(active: boolean): string {
  // Active filter chip uses the neutral-inverse pattern (dark fill in
  // light mode, light fill in dark mode). bg-strong (the strongest
  // text token, repurposed as fill) + text-canvas (the canvas token
  // used as foreground) gives the inverse contrast without reaching
  // for raw stone-900 shades. Same pattern as the subscription-panel
  // interval toggle and the usage-panel ok bar.
  return active
    ? "rounded-full bg-strong px-3 py-1 font-medium text-canvas"
    : "rounded-full bg-sunken px-3 py-1 font-medium text-default transition hover:bg-hover disabled:opacity-50 disabled:hover:bg-sunken";
}

function CaptionLine({
  flaggedOnly,
  captionWindow,
  verdict,
  source,
  totalChecks,
  totalFindings,
  flaggedCount,
  sourcesPresent,
}: {
  flaggedOnly: boolean;
  captionWindow: string;
  verdict: string;
  source: string;
  totalChecks: number;
  totalFindings: number;
  flaggedCount: number;
  sourcesPresent: string[];
}) {
  if (flaggedOnly) {
    return (
      <p className="text-xs text-default">
        Showing checks you shared via Flag for Review, {captionWindow}.
        The full list lives at{" "}
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
  const verdictPart =
    verdict.length > 0 ? ` (${VERDICT_LABEL[verdict].toLowerCase()})` : "";
  const sourcePart =
    source.length > 0 ? ` from ${SOURCE_LABEL[source] ?? source}` : "";
  return (
    <p className="text-xs text-default">
      Showing <strong className="font-medium text-strong">{totalChecks}</strong>{" "}
      {humanizeChecks(totalChecks)} {captionWindow}
      {verdictPart}
      {sourcePart}.{" "}
      <strong className="font-medium text-strong">{totalFindings}</strong>{" "}
      {totalFindings === 1 ? "finding" : "findings"} ·{" "}
      <strong className="font-medium text-strong">{flaggedCount}</strong>{" "}
      shared for review ·{" "}
      <strong className="font-medium text-strong">
        {sourcesPresent.length}
      </strong>{" "}
      {sourcesPresent.length === 1 ? "surface" : "surfaces"}.
    </p>
  );
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
      <Button
        type="button"
        size="sm"
        onClick={() => onApply(from, to)}
      >
        Apply range
      </Button>
    </section>
  );
}

function EmptyState({
  flaggedOnly,
  hasQuery,
  totalChecks,
  clearAllUrl,
}: {
  flaggedOnly: boolean;
  hasQuery: boolean;
  totalChecks: number;
  clearAllUrl: string;
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
      <div className="rounded-lg border border-dashed border-line p-4 text-sm text-quiet">
        <p>
          No checks match the search. Try fewer words, or widen the time
          window above.
        </p>
        <Link
          href={clearAllUrl}
          className={`mt-3 inline-flex ${buttonStyles({ variant: "secondary", size: "sm" })}`}
        >
          Clear filters
        </Link>
      </div>
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
    <div className="rounded-lg border border-dashed border-line p-4 text-sm text-quiet">
      <p>
        No checks match the current filter. Clear a filter pill above
        or reset everything below.
      </p>
      <Link
        href={clearAllUrl}
        className={`mt-3 inline-flex ${buttonStyles({ variant: "secondary", size: "sm" })}`}
      >
        Clear filters
      </Link>
    </div>
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
  // Counts reflect the FILTERED rows (the body), not the unfiltered
  // server counts. Fixes the day-header / body mismatch where "2
  // checks" was reported but only 1 row appeared.
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
  // Verdict chip carries the finding count inline so the top line
  // reads as one unit, not three tags.
  const verdictChipText =
    row.violationCount > 0
      ? `${row.verdictLabel} · ${row.violationCount} finding${row.violationCount === 1 ? "" : "s"}`
      : row.verdictLabel;
  const metaLine = [
    sourceLabel,
    row.contentType ? humanizeContentType(row.contentType) : null,
    row.moment ? humanizeMoment(row.moment) : null,
    `${row.unitsConsumed} ${humanizeChecks(row.unitsConsumed)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  // Mismatch banner: the verdict chip claims N findings but no
  // finding-level detail came through. Happens on rows that pre-date
  // the 2026-05-10 issue/suggestion persistence (#472) or the
  // 2026-05-08 check_event_id wire (#425). The detail page tells the
  // same story and offers a Re-run — surface a one-line nudge here
  // so the customer knows the gap exists at scan time.
  const findingsDetailMissing =
    row.violationCount > 0 &&
    !row.findings.some((f) => f.issue || f.suggestion);
  return (
    <li className="rounded-md border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Pill tone={toneFor(row.verdict)}>{verdictChipText}</Pill>
        <span className="text-right text-xs text-quiet">
          {formatRelative(new Date(row.createdAt))}
        </span>
      </div>
      {metaLine.length > 0 && (
        <p className="mt-1 text-xs text-quiet">{metaLine}</p>
      )}
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
      {row.findings.length > 0 && <FindingsList findings={row.findings} />}
      {findingsDetailMissing && (
        <p className="mt-2 text-xs text-quiet">
          Finding detail isn&apos;t available for this check.{" "}
          <Link
            href={`/dashboard/checks/${row.id}`}
            className="underline underline-offset-2 hover:text-strong"
          >
            See what we can show
          </Link>
          .
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/dashboard/checks/${row.id}`}
          className="text-xs font-medium text-quiet underline underline-offset-2 hover:text-strong"
        >
          View details →
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {row.flagged ? (
            <>
              <span className="text-xs font-medium text-accent-affirm-text">
                ✓ Shared for review
              </span>
              {row.flagId && <RevokeButton id={row.flagId} />}
            </>
          ) : row.textPreview ? (
            <FlagForReview
              text={row.textPreview}
              contentType={row.contentType}
              moment={row.moment}
              verdict={normalizeVerdict(row.verdict)}
              variant="card-action"
              label="Flag for review"
              source="dashboard"
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function FindingsList({ findings }: { findings: CheckHistoryFinding[] }) {
  // Render the issue + suggestion per finding. The block uses the
  // small uppercase "FINDINGS" eyebrow so it reads as a labeled
  // section, not a continuation of the metadata above.
  const renderable = findings.filter((f) => f.issue || f.suggestion);
  if (renderable.length === 0) return null;
  return (
    <section className="mt-3 rounded-md border border-line bg-sunken px-3 py-2 text-xs">
      <p className="text-[10px] font-medium uppercase tracking-wider text-quiet">
        Findings
      </p>
      <ul className="mt-1 flex flex-col gap-2">
        {renderable.map((f, i) => (
          <li key={i} className="text-default">
            {f.issue && <p>{f.issue}</p>}
            {f.suggestion && (
              <p className="mt-0.5 text-quiet">
                <span className="font-medium">Suggested</span>. {f.suggestion}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
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
