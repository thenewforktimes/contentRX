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

import { desc, sql } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";

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
    "Two or more standards fired with conflicting verdicts on the same string. Highest-priority subtype — fixing the taxonomy clears the downstream signal.",
  ensemble_disagreement:
    "Scan and validate disagreed. First-pass ensemble disagreeing with itself — usually a prompt-layer issue or a content_type_notes gap.",
  situation_ambiguity:
    "Moment classifier uncertain (confidence < 0.6). Upstream routing question.",
  out_of_distribution:
    "Novel input the classifier hasn't seen confidently before. Routes to the new-moment backlog.",
  novel_pattern:
    "Override rate climbing on a previously-stable rule. Drift signal — investigate before the rule's authority erodes.",
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
  // marker the Server Action writes.
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
        sql`${schema.violationOverrides.violationId} IN (${sql.raw(
          rowIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(","),
        )}) AND ${schema.violationOverrides.source} = 'dashboard' AND ${schema.violationOverrides.actorRole} = 'designer'`,
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
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Review queue
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Cases the engine flagged for review in the last {windowDays} days.
            Filter by subtype to focus the daily 15-minute review rhythm.
            Click <strong>Agree</strong> to confirm the engine&apos;s
            review-recommended verdict, <strong>Disagree</strong> to mark
            it as a false positive, or <strong>Skip</strong> to defer.
            Decisions persist into the override stream for calibration.
          </p>
        </div>
        <div className="text-sm text-neutral-700 dark:text-neutral-300">
          <span className="font-mono text-lg font-semibold">{totalQueue}</span>{" "}
          pending
        </div>
      </header>

      <nav
        aria-label="Subtype filters"
        className="flex flex-wrap gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-800"
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
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          {SUBTYPE_DESCRIPTION[activeSubtype]}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
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

      <p className="text-xs text-neutral-500">
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
    ? "rounded-md bg-neutral-900 text-white dark:bg-white dark:text-black"
    : "rounded-md bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700";
  return (
    <Link href={href} className={`${cls} px-3 py-1.5 text-xs font-medium`}>
      {label}
      <span className="ml-2 inline-flex min-w-[1.5rem] justify-center rounded bg-black/10 px-1 font-mono text-[10px] dark:bg-white/10">
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
          ? "border-neutral-200 bg-neutral-50 opacity-60 dark:border-neutral-800 dark:bg-neutral-950"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          {row.standardId ? (
            <Link
              href={`/admin/model/standards/${row.standardId}`}
              className="font-mono text-xs text-neutral-700 hover:underline dark:text-neutral-300"
            >
              {row.standardId}
            </Link>
          ) : (
            <span className="font-mono text-xs text-neutral-500">—</span>
          )}
          {row.severity && (
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                row.severity === "high"
                  ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                  : row.severity === "medium"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {row.severity}
            </span>
          )}
          {row.reviewReasonSubtype && (
            <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {row.reviewReasonSubtype.replace(/_/g, " ")}
            </span>
          )}
          {isDecided && (
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                decidedStance === "agree"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
              }`}
            >
              {decidedStance === "agree" ? "✓ Agreed" : "✗ Disagreed"}
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] text-neutral-500">
          {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-neutral-600 dark:text-neutral-400">
        {row.contentType && (
          <div>
            <dt className="font-medium uppercase tracking-wide text-neutral-500">
              Content type
            </dt>
            <dd className="font-mono">{row.contentType}</dd>
          </div>
        )}
        {row.moment && (
          <div>
            <dt className="font-medium uppercase tracking-wide text-neutral-500">
              Moment
            </dt>
            <dd className="font-mono">{row.moment}</dd>
          </div>
        )}
        {row.source && (
          <div>
            <dt className="font-medium uppercase tracking-wide text-neutral-500">
              Source
            </dt>
            <dd className="font-mono">{row.source}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 truncate font-mono text-[10px] text-neutral-400">
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
            label="Disagree"
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
      ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900"
      : stance === "disagree"
        ? "border-red-300 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
        : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";

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
