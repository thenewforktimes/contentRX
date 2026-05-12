/**
 * `/admin/queue` — review queue with subtype filters.
 *
 * Phase B3 of the post-pivot rolling plan. Read-only view of the
 * recent `review_recommended` cases, grouped by `review_reason`
 * subtype. The daily 15-minute review rhythm runs against this page;
 * decision recording (agree / override / skip) lands in a follow-up
 * PR that wires the existing `/api/violations/override` endpoint.
 *
 * Subtype vocabulary (per `src/content_checker/models.py` and
 * `human-eval build plan` Sessions 2 + 13):
 *   low_confidence | standards_conflict | ensemble_disagreement |
 *   situation_ambiguity | out_of_distribution | novel_pattern
 *
 * Privacy: every row stores `sha256(text)` only. The queue surface
 * shows the hash + the engine's metadata (content_type, moment,
 * source, subtype, timestamp). Plaintext is never displayed because
 * it never reaches the database.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import {
  humanizeContentType,
  humanizeMoment,
  humanizeReviewReason,
} from "@/lib/humanize";
import { loadSidebarCounts } from "@/lib/admin/sidebar-counts";

const SUBTYPES = [
  "low_confidence",
  "standards_conflict",
  "ensemble_disagreement",
  "situation_ambiguity",
  "out_of_distribution",
  "novel_pattern",
] as const;

type Subtype = (typeof SUBTYPES)[number];

const SUBTYPE_LABEL: Record<Subtype, string> = {
  low_confidence: "Low confidence",
  standards_conflict: "Standards conflict",
  ensemble_disagreement: "Ensemble disagreement",
  situation_ambiguity: "Situation ambiguity",
  out_of_distribution: "Out of distribution",
  novel_pattern: "Novel pattern",
};

const SUBTYPE_DESCRIPTION: Record<Subtype, string> = {
  low_confidence:
    "LLM confidence below the review threshold (0.7). Often calibration drift on a known standard.",
  standards_conflict:
    "Two or more standards fired with conflicting verdicts on the same string. Highest-priority subtype. Fixing the taxonomy clears the downstream signal.",
  ensemble_disagreement:
    "Scan and validate disagreed. First-pass ensemble disagreeing with itself. Usually a prompt-layer issue or a content_type_notes gap.",
  situation_ambiguity:
    "Moment classifier uncertain (confidence < 0.6). Upstream routing question.",
  out_of_distribution:
    "Novel input the classifier hasn't seen confidently before. Routes to the new-moment backlog.",
  novel_pattern:
    "Override rate climbing on a previously-stable rule. Drift signal. Investigate before the rule's authority erodes.",
};

const DEFAULT_WINDOW_DAYS = 30;
const MAX_ROWS_PER_SUBTYPE = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

function isSubtype(value: string | undefined): value is Subtype {
  return value !== undefined && SUBTYPES.includes(value as Subtype);
}

export const metadata = {
  title: "Queue · ContentRX admin",
  robots: { index: false, follow: false },
};

export default async function AdminQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ subtype?: string; window?: string }>;
}) {
  const params = await searchParams;
  const activeSubtype = isSubtype(params.subtype) ? params.subtype : null;
  const windowDays = clampInt(params.window, DEFAULT_WINDOW_DAYS, 1, 180);
  const since = new Date(Date.now() - windowDays * DAY_MS);

  const db = getDb();

  // Customer-flag count for the cross-link banner. Engineers
  // (Robert) repeatedly land on /queue looking for customer-shared
  // content; the queue is hash-only by privacy contract. The banner
  // makes the right next click (Customer flags) obvious instead of
  // implicit in the left rail.
  const sidebarCounts = await loadSidebarCounts().catch(() => ({
    customerFlags: 0,
  }));
  const openCustomerFlags = sidebarCounts.customerFlags;

  // Counts by subtype within the window. Drives the filter tabs.
  const counts = await db
    .select({
      subtype: schema.violations.reviewReasonSubtype,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violations)
    .where(
      sql`${schema.violations.reviewReasonSubtype} IS NOT NULL AND ${schema.violations.createdAt} >= ${since.toISOString()}`,
    )
    .groupBy(schema.violations.reviewReasonSubtype);

  const countBySubtype = new Map<string, number>();
  for (const row of counts) {
    if (row.subtype) countBySubtype.set(row.subtype, Number(row.count));
  }
  const totalQueue = Array.from(countBySubtype.values()).reduce(
    (a, b) => a + b,
    0,
  );

  // Recent rows for the active filter (or all rows when no filter).
  const rows = await db
    .select({
      id: schema.violations.id,
      createdAt: schema.violations.createdAt,
      contentType: schema.violations.contentType,
      moment: schema.violations.moment,
      standardId: schema.violations.standardId,
      severity: schema.violations.severity,
      source: schema.violations.source,
      textHash: schema.violations.textHash,
      reviewReasonSubtype: schema.violations.reviewReasonSubtype,
    })
    .from(schema.violations)
    .where(
      activeSubtype
        ? sql`${schema.violations.reviewReasonSubtype} = ${activeSubtype} AND ${schema.violations.createdAt} >= ${since.toISOString()}`
        : sql`${schema.violations.reviewReasonSubtype} IS NOT NULL AND ${schema.violations.createdAt} >= ${since.toISOString()}`,
    )
    .orderBy(desc(schema.violations.createdAt))
    .limit(MAX_ROWS_PER_SUBTYPE);

  // Look up which of these rows have already been triaged via /admin/queue.
  // We mark "decided" when there's a violation_overrides row keyed on the
  // same violationId with source="dashboard" + actorRole="designer" — the
  // marker the Server Action writes. Audit 2026-04-26 P2: switched from
  // sql.raw with manual escape to Drizzle's inArray() for type safety
  // (the IDs are server-derived cuid2 strings — never user input — so
  // there was no real injection risk, but inArray is cleaner).
  const rowIds = rows.map((r) => r.id);
  const decidedStanceById = new Map<string, string>();
  if (rowIds.length > 0) {
    const decisions = await db
      .select({
        violationId: schema.violationOverrides.violationId,
        overrideStance: schema.violationOverrides.overrideStance,
      })
      .from(schema.violationOverrides)
      .where(
        and(
          inArray(schema.violationOverrides.violationId, rowIds),
          eq(schema.violationOverrides.source, "dashboard"),
          eq(schema.violationOverrides.actorRole, "designer"),
        ),
      );
    for (const d of decisions) {
      if (d.violationId && d.overrideStance) {
        decidedStanceById.set(d.violationId, d.overrideStance);
      }
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-strong">
            Review queue
          </h1>
          <p className="mt-1 text-sm text-quiet">
            Engine-flagged cases from the last {windowDays} days,
            grouped by why the engine wasn&rsquo;t sure.{" "}
            <strong>Customer text is stored as a sha256 hash on this
            surface</strong> — the per-row text_hash below is the only
            identity. For customer-shared content (Flag-for-Review
            consent), see{" "}
            <Link
              href="/admin/customer-flags"
              className="underline underline-offset-2 hover:text-strong"
            >
              Customer flags →
            </Link>
            .
          </p>
          <p className="mt-2 text-sm text-quiet">
            Click <strong>Agree</strong> to confirm the engine&apos;s
            review-recommended verdict, <strong>False positive</strong>{" "}
            to mark it as a miscall, or <strong>Skip</strong> to defer.
            Decisions persist into the override stream for calibration.
          </p>
        </div>
        <div className="text-sm text-default">
          <span className="font-mono text-lg font-semibold">{totalQueue}</span>{" "}
          pending
        </div>
      </header>

      {openCustomerFlags > 0 && (
        <aside
          role="note"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-info-border bg-accent-info-soft p-3 text-sm text-accent-info-text"
        >
          <p>
            <strong>{openCustomerFlags} customer flag
            {openCustomerFlags === 1 ? "" : "s"}</strong>{" "}
            awaiting triage. Customer-shared content lands there with
            plaintext (per-row consent) — not on this surface.
          </p>
          <Link
            href="/admin/customer-flags"
            className="font-medium underline underline-offset-2"
          >
            Open customer flags →
          </Link>
        </aside>
      )}

      <nav
        aria-label="Subtype filters"
        className="flex flex-wrap gap-2 border-b border-line pb-3"
      >
        <FilterTab
          href={`/admin/queue?window=${windowDays}`}
          active={activeSubtype === null}
          label="All"
          count={totalQueue}
        />
        {SUBTYPES.map((subtype) => (
          <FilterTab
            key={subtype}
            href={`/admin/queue?subtype=${subtype}&window=${windowDays}`}
            active={activeSubtype === subtype}
            label={SUBTYPE_LABEL[subtype]}
            count={countBySubtype.get(subtype) ?? 0}
          />
        ))}
      </nav>

      {activeSubtype && (
        <p className="text-xs text-quiet">
          {SUBTYPE_DESCRIPTION[activeSubtype]}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-raised p-6 text-center text-sm text-quiet">
          No pending cases in this window.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <QueueRow
              key={row.id}
              row={row}
              decidedStance={decidedStanceById.get(row.id) ?? null}
            />
          ))}
        </ul>
      )}

      <p className="text-xs text-quiet">
        Showing up to {MAX_ROWS_PER_SUBTYPE} most recent cases. Older cases
        require widening the window (`?window=180`) or clustering rollups
        (Phase B5 — calibration).
      </p>
    </div>
  );
}

function FilterTab({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  const cls = active
    ? "rounded-md bg-accent-primary text-accent-primary-on"
    : "rounded-md bg-sunken text-default hover:bg-hover";
  return (
    <Link href={href} className={`${cls} px-3 py-1.5 text-xs font-medium`}>
      {label}
      <span className="ml-2 inline-flex min-w-[1.5rem] justify-center rounded bg-strong/10 px-1 font-mono text-[10px]">
        {count}
      </span>
    </Link>
  );
}

type QueueRowData = {
  id: string;
  createdAt: Date;
  contentType: string | null;
  moment: string | null;
  standardId: string | null;
  severity: string | null;
  source: string | null;
  textHash: string;
  reviewReasonSubtype: string | null;
};

function QueueRow({
  row,
  decidedStance,
}: {
  row: QueueRowData;
  decidedStance: string | null;
}) {
  const isDecided = decidedStance !== null;
  return (
    <li
      className={`rounded-lg border p-3 text-sm ${
        isDecided
          ? "border-line bg-sunken opacity-60"
          : "border-line bg-raised"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          {row.standardId ? (
            <Link
              href={`/admin/model/standards/${row.standardId}`}
              className="font-mono text-xs text-default hover:underline"
            >
              {row.standardId}
            </Link>
          ) : (
            <span className="font-mono text-xs text-quiet">—</span>
          )}
          {row.severity && (
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                row.severity === "high"
                  ? "bg-accent-concern-soft text-accent-concern-text"
                  : row.severity === "medium"
                    ? "bg-accent-caution-soft text-accent-caution-text"
                    : "bg-sunken text-default"
              }`}
            >
              {row.severity}
            </span>
          )}
          {row.reviewReasonSubtype && (
            <span className="rounded bg-sunken px-2 py-0.5 text-[10px] font-medium text-default">
              {humanizeReviewReason(row.reviewReasonSubtype)}
            </span>
          )}
          {isDecided && (
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                decidedStance === "agree"
                  ? "bg-accent-affirm-soft text-accent-affirm-text"
                  : "bg-accent-concern-soft text-accent-concern-text"
              }`}
            >
              {decidedStance === "agree" ? "✓ Agreed" : "✗ Disagreed"}
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] text-quiet">
          {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-quiet">
        {row.contentType && (
          <div>
            <dt className="font-medium uppercase tracking-wide text-quiet">
              Content type
            </dt>
            <dd>{humanizeContentType(row.contentType)}</dd>
          </div>
        )}
        {row.moment && (
          <div>
            <dt className="font-medium uppercase tracking-wide text-quiet">
              Moment
            </dt>
            <dd>{humanizeMoment(row.moment)}</dd>
          </div>
        )}
        {row.source && (
          <div>
            <dt className="font-medium uppercase tracking-wide text-quiet">
              Source
            </dt>
            <dd className="font-mono">{row.source}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 truncate font-mono text-[10px] text-quiet">
        text_hash · {row.textHash.slice(0, 16)}…
      </p>
      {!isDecided && (
        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label="Triage decision"
        >
          <DecisionForm violationId={row.id} stance="agree" label="Agree" />
          <DecisionForm
            violationId={row.id}
            stance="disagree"
            label="False positive"
          />
          <DecisionForm violationId={row.id} stance="skip" label="Skip" />
        </div>
      )}
    </li>
  );
}

function DecisionForm({
  violationId,
  stance,
  label,
}: {
  violationId: string;
  stance: "agree" | "disagree" | "skip";
  label: string;
}) {
  const cls =
    stance === "agree"
      ? "border-accent-affirm-border bg-accent-affirm-soft text-accent-affirm-text hover:bg-accent-affirm-border/30"
      : stance === "disagree"
        ? "border-accent-concern-border bg-accent-concern-soft text-accent-concern-text hover:bg-accent-concern-border/30"
        : "border-line-strong bg-raised text-default hover:bg-hover";

  async function handle() {
    "use server";
    const { recordQueueDecision } = await import("./actions");
    await recordQueueDecision(violationId, stance);
  }

  return (
    <form action={handle}>
      <button
        type="submit"
        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${cls}`}
      >
        {label}
      </button>
    </form>
  );
}

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
