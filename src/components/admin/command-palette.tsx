"use client";

/**
 * ⌘K command palette for /admin.
 *
 * Cross-source search across overrides + queue + customer flags via
 * GET /api/admin/search?q=. Loop step 3 from the redesign — finding
 * a past review case across surfaces without filter-tab-spelunking.
 *
 * Bindings:
 *   - ⌘K / Ctrl+K toggles the palette (anywhere on /admin/*)
 *   - / focuses the input when the palette is already open
 *   - ESC closes
 *   - ↑ / ↓ moves selection; Enter follows the current row
 *
 * Accepts plain substrings, standard IDs ("ACT-01"), and hash prefixes
 * ("#a3f2…"). The backend handles routing per query shape.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pill, type PillTone } from "@/components/ui/pill";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

type ResultType = "override" | "queue" | "flag";

interface SearchResult {
  type: ResultType;
  id: string;
  textPreview: string;
  contextLine: string;
  createdAt: string;
  href: string;
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
  countsBySource: Record<ResultType, number>;
  truncated: boolean;
}

const TYPE_LABEL: Record<ResultType, string> = {
  override: "Override",
  queue: "Queue",
  flag: "Flag",
};

// Pill primitive doesn't include purple; flag shares "info" semantics
// with the blue tone — distinguished by the label text.
const TYPE_PILL_TONE: Record<ResultType, PillTone> = {
  override: "blue",
  queue: "amber",
  flag: "neutral",
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const titleId = useId();
  const listboxId = useId();
  const router = useRouter();

  // Focus management: trap focus inside the palette, ESC closes,
  // background inert, focus restored to the trigger on close.
  // Initial focus goes to the search input (the user's primary
  // action). Replaces the prior partial implementation that didn't
  // trap Tab and didn't restore focus.
  useFocusTrap({
    active: open,
    containerRef: dialogRef,
    onClose: () => setOpen(false),
    initialFocusRef: inputRef,
  });

  // Toggle on Cmd/Ctrl+K from anywhere.
  useEffect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, []);

  // Reset state when closed; initial focus is handled by useFocusTrap.
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
    } else {
      setQuery("");
      setResults([]);
      setError(null);
    }
  }, [open]);

  // Debounced fetch on query change.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setError(null);
      return;
    }

    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/search?q=${encodeURIComponent(trimmed)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const body = (await res.json()) as SearchResponse;
        setResults(body.results);
        setActiveIndex(0);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Could not run the search.",
        );
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open]);

  // Arrow / Enter handling (ESC is owned by useFocusTrap).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        const target = results[activeIndex];
        if (target) {
          e.preventDefault();
          setOpen(false);
          router.push(target.href);
        }
      }
    },
    [results, activeIndex, router],
  );

  const grouped = useMemo(() => {
    const out: Record<ResultType, SearchResult[]> = {
      override: [],
      queue: [],
      flag: [],
    };
    for (const r of results) out[r.type].push(r);
    return out;
  }, [results]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search palette"
        aria-haspopup="dialog"
        aria-expanded={open}
        // Old className was `hover:border-line-strong` which matched
        // the rest border — visual no-op on hover (looked broken). Hover
        // now lifts to bg-overlay so the trigger reads as interactive.
        // focus-visible ring added — keyboard users opening the palette
        // via Cmd+K never tab here, but anyone tabbing through the
        // sidebar did and got nothing. WCAG 2.4.7.
        className="flex w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-raised px-3 py-1.5 text-left text-xs text-quiet transition-colors hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <span>Find a case…</span>
        <kbd className="rounded border border-line-strong bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-quiet">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            onKeyDown={onKeyDown}
            className="w-full max-w-2xl overflow-hidden rounded-lg border border-line bg-raised shadow-2xl"
          >
            {/*
             * Visually-hidden title — the dialog needs a labelled-by
             * target that's actually a heading (the input itself isn't
             * a label, even though earlier code pointed `aria-labelledby`
             * at it). Screen readers announce "Search admin, dialog"
             * on open.
             */}
            <h2 id={titleId} className="sr-only">
              Search admin
            </h2>
            <div className="border-b border-line">
              {/*
               * Combobox pattern: the input owns the listbox below
               * via aria-controls, exposes expanded state, and points
               * at the active option for screen-reader announcement
               * as arrow keys move selection.
               */}
              <input
                id={inputId}
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={
                  results.length > 0 && results[activeIndex]
                    ? `${listboxId}-${activeIndex}`
                    : undefined
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a case across overrides, queue, and customer flags…"
                // Inset focus-visible ring: the input fades into the
                // dialog container, but a user tabbing FROM a result
                // row back TO the input needs a clear cue that focus
                // returned to the search field. WCAG 2.4.7.
                className="w-full bg-transparent px-4 py-3 text-base text-strong placeholder:text-quiet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset rounded-t-lg"
              />
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {error && (
                <p className="px-4 py-3 text-sm text-accent-concern-text">
                  {error}
                </p>
              )}
              {!error && query.trim().length === 0 && (
                <div className="px-4 py-6 text-sm text-quiet">
                  <p>
                    Type to search across{" "}
                    <span className="font-medium">overrides</span>,{" "}
                    <span className="font-medium">queue items</span>, and{" "}
                    <span className="font-medium">customer flags</span>.
                  </p>
                  <ul className="mt-3 space-y-1 text-xs">
                    <li>
                      Plain text — substring match against text + notes
                    </li>
                    <li>
                      <span className="font-mono">ACT-01</span> — match a
                      standard ID
                    </li>
                    <li>
                      <span className="font-mono">#a3f2…</span> — match a
                      text-hash prefix
                    </li>
                  </ul>
                </div>
              )}
              {!error && query.trim().length > 0 && results.length === 0 && (
                <p className="px-4 py-6 text-sm text-quiet">
                  {loading ? "Searching…" : "No matches."}
                </p>
              )}
              {!error && results.length > 0 && (
                <ul id={listboxId} role="listbox" aria-label="Search results">
                  {results.map((r, idx) => (
                    <ResultRow
                      key={`${r.type}-${r.id}`}
                      result={r}
                      optionId={`${listboxId}-${idx}`}
                      active={idx === activeIndex}
                      onHover={() => setActiveIndex(idx)}
                      onSelect={() => setOpen(false)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-quiet">
              <span>
                {results.length > 0 ? (
                  <>
                    {grouped.override.length} override
                    {grouped.override.length === 1 ? "" : "s"} ·{" "}
                    {grouped.queue.length} queue ·{" "}
                    {grouped.flag.length} flag
                    {grouped.flag.length === 1 ? "" : "s"}
                  </>
                ) : (
                  <span>↑↓ to move · Enter to open · Esc to close</span>
                )}
              </span>
              {loading && <span>Searching…</span>}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function ResultRow({
  result,
  optionId,
  active,
  onHover,
  onSelect,
}: {
  result: SearchResult;
  optionId: string;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <li
      id={optionId}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      className={`border-b border-line last:border-b-0 ${
        active ? "bg-hover" : ""
      }`}
    >
      <Link
        href={result.href}
        onClick={onSelect}
        // Inset focus-visible cue on the link itself so keyboard
        // users tabbing into results (rather than driving via arrow
        // keys + activedescendant) get a clear focus anchor. The
        // aria-selected row bg is the arrow-key cue; this is the
        // direct-tab cue. WCAG 2.4.7.
        className="block px-4 py-3 focus-visible:outline-none focus-visible:bg-hover"
      >
        <div className="flex items-start gap-3">
          <Pill
            tone={TYPE_PILL_TONE[result.type]}
            size="xs"
            className="shrink-0 uppercase tracking-wide"
          >
            {TYPE_LABEL[result.type]}
          </Pill>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-strong">
              {result.textPreview}
            </p>
            <p className="mt-1 truncate text-xs text-quiet">
              {result.contextLine}
            </p>
          </div>
          <span className="shrink-0 self-center text-[11px] text-quiet">
            {formatRelative(new Date(result.createdAt))}
          </span>
        </div>
      </Link>
    </li>
  );
}

function formatRelative(date: Date): string {
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
