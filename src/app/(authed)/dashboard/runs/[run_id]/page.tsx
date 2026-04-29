/**
 * /dashboard/runs/[run_id] — per-run summary page (PR-40).
 *
 * The GitHub Action posts a sticky PR comment that links here. PRs
 * close, action logs roll over, the comment scrolls past the PR
 * tab — this page is the durable record of what got flagged in that
 * workflow run.
 *
 * What's on the page:
 *   - run_id + earliest/latest log time in the run
 *   - rollups: total findings, files, hard violations vs review
 *   - per-file breakdown: each file's findings, with severity badge,
 *     issue text, and (when present) source-file line + moment
 *
 * Privacy contract (ADR 2026-04-25 / schema 2.0.0):
 *   - We render `severity`, `moment`, `content_type`, `file_path`,
 *     `issue` text equivalents — all already user-visible context.
 *   - We do NOT render `standard_id`. The select includes it for
 *     internal aggregation but the JSX never emits it.
 *   - We do NOT render hashed text — there's nothing useful for the
 *     user to do with a sha256.
 *
 * Auth: Clerk session required. Anyone on the team that owns the run
 * (matched via violations.team_id) can view it. Free/Pro users see
 * their own runs (team_id is null; we match user_id directly).
 *
 * No-result fallback: if the run_id matches no rows for this team,
 * render a "Run not found or expired" message rather than 404 — the
 * row may still exist but for a different team, and we don't want
 * the URL itself to leak run-id existence.
 */

import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import {
  humanizeContentType,
  humanizeMoment,
  humanizeReviewReason,
} from "@/lib/humanize";
import { getOrProvisionUser } from "@/lib/user-provisioning";

// Display cap: even runs with thousands of findings render at most
// this many rows. The aggregate query covers the totals so the headline
// stats stay accurate; the per-file lists just become "first N
// findings, X more not shown" when overflowing. Audit Pf4.
const DISPLAYED_FINDINGS_LIMIT = 500;

type RunParams = {
  params: Promise<{ run_id: string }>;
};

type ViolationRow = {
  id: string;
  createdAt: Date;
  filePath: string | null;
  moment: string | null;
  contentType: string;
  severity: string;
  source: string;
  reviewReasonSubtype: string | null;
};

export default async function RunPage({ params }: RunParams) {
  const { run_id } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect(`/sign-in?redirect_url=/dashboard/runs/${run_id}`);
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-neutral-200 p-6 text-sm dark:border-neutral-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const teamId = user.teamOwnerUserId ?? user.id;

  const db = getDb();

  // One query for the displayed rows, one parallel query for stats
  // computed in SQL. This keeps the page accurate even for huge runs
  // — the displayed list is capped, but the headline numbers
  // (findings, files, severity counts, time range) reflect the
  // full set. Audit Pf4.
  const filterClause = and(
    eq(schema.violations.runId, run_id),
    or(
      eq(schema.violations.teamId, teamId),
      eq(schema.violations.userId, user.id),
    ),
  );

  const [rows, statsRows] = await Promise.all([
    db
      .select({
        id: schema.violations.id,
        createdAt: schema.violations.createdAt,
        filePath: schema.violations.filePath,
        moment: schema.violations.moment,
        contentType: schema.violations.contentType,
        severity: schema.violations.severity,
        source: schema.violations.source,
        reviewReasonSubtype: schema.violations.reviewReasonSubtype,
      })
      .from(schema.violations)
      .where(filterClause)
      .orderBy(asc(schema.violations.filePath), asc(schema.violations.createdAt))
      .limit(DISPLAYED_FINDINGS_LIMIT) as Promise<ViolationRow[]>,
    db
      .select({
        total: sql<number>`count(*)::int`,
        fileCount: sql<number>`count(distinct ${schema.violations.filePath})::int`,
        highCount: sql<number>`count(*) filter (where ${schema.violations.severity} = 'high')::int`,
        mediumCount: sql<number>`count(*) filter (where ${schema.violations.severity} = 'medium')::int`,
        lowCount: sql<number>`count(*) filter (where ${schema.violations.severity} = 'low')::int`,
        earliestAt: sql<Date | null>`min(${schema.violations.createdAt})`,
        latestAt: sql<Date | null>`max(${schema.violations.createdAt})`,
      })
      .from(schema.violations)
      .where(filterClause),
  ]);

  const stats = statsRows[0];

  if (!stats || stats.total === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Eyebrow>Run</Eyebrow>
        <h1 className="text-2xl font-semibold">{run_id}</h1>
        <section className="rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            This run has no findings on your account, or it expired.
            ContentRX retains run history for 90 days.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm underline"
          >
            ← Back to dashboard
          </Link>
        </section>
      </div>
    );
  }

  // Stats come from the SQL aggregate over the full set; the displayed
  // rows may be a capped subset. Group capped rows by file for display.
  const byFile = new Map<string, ViolationRow[]>();
  for (const row of rows) {
    const key = row.filePath ?? "(no file)";
    const list = byFile.get(key);
    if (list) list.push(row);
    else byFile.set(key, [row]);
  }
  // Files sorted by finding count desc — biggest hot-spots first.
  const sortedFiles = [...byFile.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );

  const earliestAt = stats.earliestAt
    ? new Date(stats.earliestAt)
    : new Date();
  const latestAt = stats.latestAt ? new Date(stats.latestAt) : new Date();
  const truncated = stats.total > rows.length;

  const sourceLabel = (() => {
    const sources = new Set(rows.map((r) => r.source));
    if (sources.size === 1) {
      const s = rows[0].source;
      if (s === "action") return "GitHub Action";
      if (s === "cli") return "CLI";
      if (s === "mcp") return "MCP";
      if (s === "lsp") return "LSP";
      if (s === "plugin") return "Figma plugin";
    }
    return "mixed";
  })();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow>Run</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold tabular-nums">{run_id}</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {sourceLabel} · {formatTimeRange(earliestAt, latestAt)}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Findings" value={stats.total} />
        <Stat label="Files" value={stats.fileCount} />
        <Stat label="High" value={stats.highCount} tone="high" />
        <Stat
          label="Medium / low"
          value={stats.mediumCount + stats.lowCount}
          tone="muted"
        />
      </section>

      {truncated && (
        <p className="rounded-md border border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Showing the first {rows.length.toLocaleString()} findings of{" "}
          {stats.total.toLocaleString()}. Earlier findings on the same files
          aren&apos;t listed below. Totals above remain accurate.
        </p>
      )}

      <section className="flex flex-col gap-4">
        {sortedFiles.map(([file, items]) => (
          <FileBlock key={file} file={file} items={items} />
        ))}
      </section>

      <Link
        href="/dashboard"
        className="text-sm text-neutral-600 underline hover:no-underline dark:text-neutral-300"
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "high" | "muted";
}) {
  const valueClasses =
    tone === "high"
      ? "text-red-700 dark:text-red-400"
      : tone === "muted"
        ? "text-neutral-700 dark:text-neutral-300"
        : "text-neutral-900 dark:text-neutral-100";
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClasses}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function FileBlock({
  file,
  items,
}: {
  file: string;
  items: ViolationRow[];
}) {
  return (
    <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <code className="text-sm font-medium">{file}</code>
        <span className="text-xs text-neutral-500">
          {items.length} {items.length === 1 ? "finding" : "findings"}
        </span>
      </header>
      <ul className="flex flex-col gap-2">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex items-start gap-3 rounded-md bg-neutral-50 p-3 text-sm dark:bg-neutral-900"
          >
            <SeverityDot severity={it.severity} />
            <div className="flex-1">
              <div className="text-neutral-700 dark:text-neutral-300">
                {humanizeContentType(it.contentType)}
                {it.moment && (
                  <>
                    {" · "}
                    {humanizeMoment(it.moment)}
                  </>
                )}
              </div>
              {it.reviewReasonSubtype && (
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Review recommended:{" "}
                  {humanizeReviewReason(it.reviewReasonSubtype)}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const tone =
    severity === "high"
      ? "bg-red-500"
      : severity === "medium"
        ? "bg-amber-500"
        : "bg-neutral-400";
  return (
    <span
      className={`mt-1.5 inline-block h-2 w-2 flex-none rounded-full ${tone}`}
      aria-label={`${severity} severity`}
    />
  );
}

function formatTimeRange(earliest: Date, latest: Date): string {
  const sameDay =
    earliest.toDateString() === latest.toDateString();
  const dateOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  if (sameDay) {
    return (
      earliest.toLocaleDateString(undefined, dateOpts) +
      " · " +
      earliest.toLocaleTimeString(undefined, timeOpts) +
      "–" +
      latest.toLocaleTimeString(undefined, timeOpts)
    );
  }
  return (
    earliest.toLocaleDateString(undefined, dateOpts) +
    " → " +
    latest.toLocaleDateString(undefined, dateOpts)
  );
}
