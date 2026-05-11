/**
 * /dashboard/runs/[run_id] — durable record of a single Github Action run.
 *
 * Two surfaces, two purposes:
 *
 * 1. **The PR comment** is the real-time actionable surface. The
 *    Action posts it with full issue text + a diff-fenced suggestion
 *    for each finding (rendered natively by GitHub's review UI).
 *    Engineers act there, in PR-review context.
 *
 * 2. **This dashboard page** is the durable record once the PR
 *    closes and the action log rolls over. It shows the customer's
 *    flagged strings (joined from usage_events.text_preview, same
 *    privacy posture as Check history — the customer's own data
 *    shown back to them per ADR 2026-04-28) plus the metadata
 *    needed for compliance / "what got flagged where" review.
 *
 * What renders per finding:
 *   - severity dot
 *   - text_preview (first 80 chars of the original input, joined
 *     via violations.check_event_id ↔ usage_events.id)
 *   - content_type · moment (humanized)
 * Grouped by file path; per-file finding count badge; top-of-page
 * rollup (total findings, files, severity breakdown, time range,
 * source surface).
 *
 * Privacy contract (ADR 2026-04-25 / 2026-04-28):
 *   - NEVER renders `standard_id` (substrate, founder-only)
 *   - NEVER renders text_hash (no value to customer)
 *   - NEVER renders review_reason_subtype here (those labels are
 *     for /admin triage; out of context they leak anxious chatbot
 *     voice and violate the calm-voice rule).
 *   - WILL render: text_preview (customer's own data), severity,
 *     content_type, moment, file_path
 *   - DOES NOT render the engine's issue text or suggestion —
 *     those aren't stored on violations rows. The PR comment is
 *     where those live.
 *
 * Auth: Clerk session. Team members see the team's runs (matched via
 * violations.team_id); solo users see their own (team_id null +
 * user_id match).
 *
 * No-result fallback: render a friendly note rather than 404 — the
 * row may exist for a different team, and the URL itself shouldn't
 * leak run-id existence.
 */

import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import { humanizeContentType, humanizeMoment } from "@/lib/humanize";
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
  // Joined from usage_events.text_preview via violations.check_event_id.
  // First 80 chars of the original input — same data Check history
  // shows for the same row. Nullable: legacy violations rows without
  // a checkEventId, or rows whose usage_event was pruned past TTL.
  textPreview: string | null;
  // Identity of the input string. The same string flagged against N
  // standards produces N rows that all share the same textHash; the
  // rendering layer collapses by textHash so a string appears once
  // with a severity-pip cluster, not N times in identical-looking
  // rows.
  textHash: string;
};

/** A unique input string within one file, with all the violation
 * rows that fired against it. The renderer shows one of these per
 * card; the sub-rows surface on expand. */
type StringGroup = {
  textHash: string;
  textPreview: string | null;
  contentType: string;
  moment: string | null;
  /** All violations that fired on this string, in insertion order
   * from the SQL `ORDER BY createdAt`. */
  violations: ViolationRow[];
  /** Rank used for sort within a file: rank of the highest-severity
   * violation in this group. high=3, medium=2, low=1. */
  maxSeverityRank: number;
};

const SEVERITY_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
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
      <section className="rounded-lg border border-line p-6 text-sm">
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
        // review_reason_subtype intentionally not selected. Those
        // labels are designed for /admin triage; out of context here
        // they leak anxious chatbot voice. The audit log shows what
        // got flagged, not why the engine wasn't sure.
        //
        // text_preview joined via violations.check_event_id ↔
        // usage_events.id. Same string the customer sees in Check
        // history for the matching call. Privacy posture: customer's
        // own input shown back to them is part of the customer-not-
        // product contract (ADR 2026-04-28). Nullable: legacy
        // violations without a checkEventId, or usage_event pruned
        // past TTL.
        textPreview: schema.usageEvents.textPreview,
        // textHash is the identity of the input string. The renderer
        // collapses rows by textHash so a string flagged against
        // multiple standards appears once with a severity-pip cluster,
        // not N times in identical-looking rows.
        textHash: schema.violations.textHash,
      })
      .from(schema.violations)
      .leftJoin(
        schema.usageEvents,
        eq(schema.violations.checkEventId, schema.usageEvents.id),
      )
      .where(filterClause)
      .orderBy(asc(schema.violations.filePath), asc(schema.violations.createdAt))
      .limit(DISPLAYED_FINDINGS_LIMIT) as Promise<ViolationRow[]>,
    db
      .select({
        total: sql<number>`count(*)::int`,
        fileCount: sql<number>`count(distinct ${schema.violations.filePath})::int`,
        // Unique-string count across the whole run (not just the
        // displayed-rows window). The collapse-by-textHash render
        // uses this to be honest about the dedup ratio in the stat
        // card row: "5 strings · 7 findings."
        stringCount: sql<number>`count(distinct ${schema.violations.textHash})::int`,
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
        <Eyebrow>Run audit log</Eyebrow>
        <h1 className="text-2xl font-semibold tabular-nums">{run_id}</h1>
        <section className="rounded-lg border border-line p-6">
          <p className="text-sm text-default">
            No findings logged for this run. Either the GitHub Action
            ran your checks and they all passed, or the run was from
            a different team. ContentRX keeps run history for 90 days.
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
  // rows may be a capped subset. Two-level grouping for display:
  //   1. by file path
  //   2. within each file, by textHash (one card per unique input
  //      string; severity-pip cluster shows how many rules fired)
  //
  // Without the textHash collapse, a single string flagged against
  // 4 standards rendered as 4 visually identical rows — at scale
  // (50-string PR × ~3 rules per string = 150 rows of repeats) the
  // page becomes unreadable. The collapse reflects the user's mental
  // model (strings, not rule fires) while preserving full detail
  // via the per-card expand.
  const byFile = new Map<string, Map<string, StringGroup>>();
  for (const row of rows) {
    const filePath = row.filePath ?? "(no file)";
    let perFile = byFile.get(filePath);
    if (!perFile) {
      perFile = new Map<string, StringGroup>();
      byFile.set(filePath, perFile);
    }
    const existing = perFile.get(row.textHash);
    const severityRank = SEVERITY_RANK[row.severity] ?? 0;
    if (existing) {
      existing.violations.push(row);
      if (severityRank > existing.maxSeverityRank) {
        existing.maxSeverityRank = severityRank;
      }
    } else {
      perFile.set(row.textHash, {
        textHash: row.textHash,
        textPreview: row.textPreview,
        contentType: row.contentType,
        moment: row.moment,
        violations: [row],
        maxSeverityRank: severityRank,
      });
    }
  }

  // Files sorted by finding count desc — biggest hot-spots first.
  // Within each file, strings sorted by max severity then finding
  // count, so the loudest problems rise to the top.
  const sortedFiles: Array<[string, StringGroup[]]> = [...byFile.entries()]
    .map(([file, groupMap]) => {
      const stringGroups = [...groupMap.values()].sort((a, b) => {
        if (b.maxSeverityRank !== a.maxSeverityRank) {
          return b.maxSeverityRank - a.maxSeverityRank;
        }
        return b.violations.length - a.violations.length;
      });
      return [file, stringGroups] as [string, StringGroup[]];
    })
    .sort((a, b) => {
      const aFindings = a[1].reduce((sum, g) => sum + g.violations.length, 0);
      const bFindings = b[1].reduce((sum, g) => sum + g.violations.length, 0);
      return bFindings - aFindings;
    });

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
        <Eyebrow>Run audit log</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold tabular-nums">{run_id}</h1>
        <p className="mt-1 text-sm text-default">
          {sourceLabel} · {formatTimeRange(earliestAt, latestAt)}
        </p>
      </header>

      {/*
        Two surfaces, two purposes — be explicit about it so the page
        doesn't read like it's missing the content engineers expect.
        The PR comment is where the issue text + diff-fenced
        suggestions live; this page is the durable record (with the
        flagged strings) once the PR closes.
      */}
      <aside className="rounded-md border border-line bg-overlay p-3 text-xs text-default">
        Checks + flags live here as a durable record. The original
        GitHub Action comment on the PR carries the issue text and a
        diff-fenced suggestion for each finding. Open the PR to act on
        them in GitHub&apos;s review UI.
      </aside>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Findings" value={stats.total} />
        <Stat label="Checks" value={stats.stringCount} />
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
        {sortedFiles.map(([file, stringGroups]) => (
          <FileBlock key={file} file={file} groups={stringGroups} />
        ))}
      </section>

      <Link
        href="/dashboard"
        className="text-sm text-default underline hover:no-underline"
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
      ? "text-rose-700 dark:text-rose-400"
      : tone === "muted"
        ? "text-default"
        : "text-strong";
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="text-xs uppercase tracking-wide text-quiet">
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
  groups,
}: {
  file: string;
  groups: StringGroup[];
}) {
  const totalFindings = groups.reduce((sum, g) => sum + g.violations.length, 0);
  return (
    <section className="rounded-lg border border-line p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <code className="truncate text-sm font-medium" title={file}>
          {file}
        </code>
        <span className="whitespace-nowrap text-xs text-quiet">
          {groups.length} {groups.length === 1 ? "string" : "strings"} ·{" "}
          {totalFindings} {totalFindings === 1 ? "finding" : "findings"}
        </span>
      </header>
      <ul className="flex flex-col gap-2">
        {groups.map((g) => (
          <StringRow key={g.textHash} group={g} />
        ))}
      </ul>
    </section>
  );
}

/** One row per unique input string. The native <details> element
 * gives us free expand/collapse with no client JS. The summary
 * shows the severity-pip cluster + truncated string + categorised
 * metadata; the body shows each individual rule fire as a sub-row. */
function StringRow({ group }: { group: StringGroup }) {
  const findingCount = group.violations.length;
  const expandable = findingCount > 1;
  const summary = (
    <div className="flex items-start gap-3">
      <SeverityPips severities={group.violations.map((v) => v.severity)} />
      <div className="min-w-0 flex-1">
        {group.textPreview ? (
          <p className="truncate font-mono text-xs text-strong">
            {group.textPreview}
          </p>
        ) : (
          <p className="font-mono text-xs italic text-quiet">
            (no preview available)
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-xs text-quiet">
          <span>
            {findingCount} {findingCount === 1 ? "finding" : "findings"} ·{" "}
            {humanizeContentType(group.contentType)}
            {group.moment && (
              <>
                {" · "}
                {humanizeMoment(group.moment)}
              </>
            )}
          </span>
          {expandable && (
            <span aria-hidden className="text-quiet">
              ▸
            </span>
          )}
        </div>
      </div>
    </div>
  );

  if (!expandable) {
    return (
      <li className="rounded-md bg-overlay p-3 text-sm">
        {summary}
      </li>
    );
  }
  return (
    <li>
      <details className="group rounded-md bg-overlay p-3 text-sm [&[open]>summary>div>div>div>span[aria-hidden]]:rotate-90">
        <summary className="cursor-pointer list-none">{summary}</summary>
        <ul className="mt-3 ml-7 flex flex-col gap-1.5 border-l border-line pl-3">
          {group.violations.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-2 text-xs text-default"
            >
              <SeverityDot severity={v.severity} />
              <span className="text-strong">
                {humanizeSeverityLabel(v.severity)}
              </span>
              {v.moment && (
                <>
                  <span className="text-quiet">·</span>
                  <span>{humanizeMoment(v.moment)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** Up to 4 dots representing each violation's severity. Beyond 4
 * we render "+N" instead so the cluster doesn't sprawl. */
function SeverityPips({ severities }: { severities: string[] }) {
  const visible = severities.slice(0, 4);
  const overflow = severities.length - visible.length;
  return (
    <span
      className="mt-1 inline-flex flex-none items-center gap-0.5"
      aria-label={`${severities.length} findings`}
    >
      {visible.map((s, i) => (
        <SeverityDot key={i} severity={s} />
      ))}
      {overflow > 0 && (
        <span className="ml-1 text-[10px] font-medium tabular-nums text-quiet">
          +{overflow}
        </span>
      )}
    </span>
  );
}

function humanizeSeverityLabel(severity: string): string {
  if (severity === "high") return "High";
  if (severity === "medium") return "Medium";
  if (severity === "low") return "Low";
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function SeverityDot({ severity }: { severity: string }) {
  // Severity dots map to the design system's three "urgency" accents:
  // concern (red) for high, caution (amber) for medium, info (blue)
  // for low. All three solids pair with -on text and meet WCAG AAA;
  // pre-token the dots used raw shades (rose/amber/stone) that didn't
  // verify against the contrast checker.
  const tone =
    severity === "high"
      ? "bg-accent-concern-solid"
      : severity === "medium"
        ? "bg-accent-caution-solid"
        : "bg-accent-info-solid";
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
