/**
 * `/admin` — Today's queue (the curated daily-driver).
 *
 * The founder dashboard's landing page. Reframed from pilot tracker
 * (now at /admin/pilots) to a focused review surface that supports
 * the daily 15-minute model-improvement rhythm:
 *
 *   1. Default filter to NUANCED subtypes only
 *      (standards_conflict, ensemble_disagreement, novel_pattern) —
 *      cases whose adjudication actually moves the model. The routine
 *      noise (low_confidence, situation_ambiguity, OOD) opts in via
 *      the pills.
 *   2. 7-day window — the daily-driver scope, not the exhaustive one.
 *      `/admin/queue` keeps the 30-day exhaustive view.
 *   3. Pilot snapshot in the right rail — pilots tracker visible,
 *      one click away, but not the headline.
 *   4. Conversation triggers in the right rail — the same nudges from
 *      the old landing carry over, since they apply to the same
 *      operational picture.
 *
 * Pills toggle subtypes via URL: `?subtypes=standards_conflict,novel_pattern`.
 * Empty string (`?subtypes=`) clears all (renders empty queue with
 * counts visible so the user can opt back in).
 *
 * Auth via `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import {
  conversationTriggers,
  loadPilotTracker,
} from "@/lib/admin/pilot-tracker";
import {
  ALL_SUBTYPES,
  loadTodayQueue,
  NUANCED_SUBTYPES,
  parseSubtypesParam,
  SUBTYPE_LABEL,
  SUBTYPE_ONELINER,
  type Subtype,
  type TodayQueueRow,
} from "@/lib/admin/today-queue";
import { humanizeContentType, humanizeMoment } from "@/lib/humanize";
import { Pill, type PillTone } from "@/components/ui/pill";

export const metadata = {
  title: "Today’s queue · ContentRX admin",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ subtypes?: string }>;
}

export default async function AdminTodayPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const parsed = parseSubtypesParam(params.subtypes);
  const selected =
    parsed === null
      ? NUANCED_SUBTYPES.slice()
      : (parsed as Subtype[]);

  const [queue, pilots] = await Promise.all([
    loadTodayQueue({ selectedSubtypes: selected }),
    loadPilotTracker(),
  ]);
  const triggers = conversationTriggers(pilots);
  const pilotSummary = summarizePilots(pilots);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-quiet">
            {today}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-strong">
            Today&rsquo;s queue
          </h1>
          <p className="mt-1 text-sm text-quiet">
            The cases worth your nuance — recent flagged checks where the
            resolution improves the model. Routine subtypes are off by
            default.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums text-strong">
            {queue.rows.length}
          </p>
          <p className="text-xs text-quiet">
            in view
          </p>
        </div>
      </header>

      <SubtypeFilterPills
        selected={queue.selectedSubtypes}
        countsBySubtype={queue.countsBySubtype}
      />

      {queue.selectedSubtypes.length > 0 && (
        <p className="text-xs text-quiet">
          {queue.selectedSubtypes
            .map((s) => SUBTYPE_LABEL[s])
            .join(" · ")}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <QueueList rows={queue.rows} />
        <RightRail pilotSummary={pilotSummary} triggers={triggers} />
      </div>

      <p className="text-xs text-quiet">
        Looking for the exhaustive view across every subtype and a
        180-day window?{" "}
        <Link
          href="/admin/queue"
          className="underline underline-offset-2 hover:text-strong"
        >
          Open the full queue
        </Link>
        .
      </p>
    </div>
  );
}

function SubtypeFilterPills({
  selected,
  countsBySubtype,
}: {
  selected: Subtype[];
  countsBySubtype: Record<Subtype, number>;
}) {
  const selectedSet = new Set(selected);

  return (
    <nav
      aria-label="Subtype filter"
      className="flex flex-wrap gap-2 border-b border-line pb-3"
    >
      <PresetPill
        label="Nuanced (default)"
        active={
          selected.length === NUANCED_SUBTYPES.length &&
          NUANCED_SUBTYPES.every((s) => selectedSet.has(s))
        }
        href="/admin"
      />
      <PresetPill
        label="All"
        active={
          selected.length === ALL_SUBTYPES.length &&
          ALL_SUBTYPES.every((s) => selectedSet.has(s))
        }
        href={`/admin?subtypes=${ALL_SUBTYPES.join(",")}`}
      />
      <span className="mx-1 self-center text-xs text-quiet">
        |
      </span>
      {ALL_SUBTYPES.map((s) => {
        const isOn = selectedSet.has(s);
        const next = isOn
          ? selected.filter((x) => x !== s)
          : [...selected, s];
        const href =
          next.length === 0 ? "/admin?subtypes=" : `/admin?subtypes=${next.join(",")}`;
        return (
          <SubtypePill
            key={s}
            href={href}
            label={SUBTYPE_LABEL[s]}
            count={countsBySubtype[s]}
            active={isOn}
            tooltip={SUBTYPE_ONELINER[s]}
          />
        );
      })}
    </nav>
  );
}

// Filter buttons (PR #305 precedent: "tabs are not pills" — these are
// rounded-full interactive controls, not status tags). Both Preset and
// Subtype share the same shell geometry so the row reads as one
// consistent set of buttons regardless of which is active. Inactive
// gets a quiet border + ghost bg; active gets a solid bg + strong text.
const FILTER_BASE =
  "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition";

function PresetPill({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={[
        FILTER_BASE,
        active
          ? "border-strong bg-strong text-canvas"
          : "border-line text-quiet hover:border-line-strong hover:text-strong",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function SubtypePill({
  href,
  label,
  count,
  active,
  tooltip,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  tooltip: string;
}) {
  return (
    <Link
      href={href}
      title={tooltip}
      className={[
        FILTER_BASE,
        active
          ? "border-line-strong bg-overlay text-strong"
          : "border-line text-quiet hover:border-line-strong hover:text-strong",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums opacity-70">· {count}</span>
    </Link>
  );
}

function QueueList({ rows }: { rows: TodayQueueRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-raised p-8 text-center text-sm text-quiet">
        <p className="font-medium text-default">
          Nothing in this view.
        </p>
        <p className="mt-1">
          Either the engine has been calm in the last 7 days, or you&rsquo;ve
          turned every subtype off in the filter above.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <QueueRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function QueueRow({ row }: { row: TodayQueueRow }) {
  const tone = subtypePillTone(row.subtype);
  return (
    <li className="rounded-md border border-line bg-raised p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Pill tone={tone}>{SUBTYPE_LABEL[row.subtype]}</Pill>
          {row.contentType && (
            <span className="text-quiet">
              {humanizeContentType(row.contentType)}
            </span>
          )}
          {row.moment && (
            <span className="text-quiet">
              · {humanizeMoment(row.moment)}
            </span>
          )}
          {row.source && (
            <span className="text-quiet">
              · {row.source}
            </span>
          )}
        </div>
        <div className="text-right text-xs text-quiet">
          {formatRelative(row.createdAt)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-mono text-default">
          {row.standardId}
        </span>
        {row.severity && (
          <span className="text-quiet">
            severity: {row.severity}
          </span>
        )}
        {row.textHash && (
          <span className="font-mono text-quiet">
            #{row.textHash.slice(0, 12)}
          </span>
        )}
        <Link
          href={`/admin/queue?subtype=${row.subtype}`}
          className="ml-auto text-quiet underline underline-offset-2 hover:text-strong"
        >
          Triage in queue →
        </Link>
      </div>
    </li>
  );
}

function RightRail({
  pilotSummary,
  triggers,
}: {
  pilotSummary: PilotSummary;
  triggers: ReturnType<typeof conversationTriggers>;
}) {
  return (
    <aside className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
          Pilots snapshot
        </h2>
        <ul className="mt-2 space-y-1 text-xs">
          <RailRow label="Active 48h" value={pilotSummary.active} tone="green" />
          <RailRow label="Slowing" value={pilotSummary.amber} tone="amber" />
          <RailRow label="At risk" value={pilotSummary.red} tone="red" />
          <RailRow
            label="Paused (cost)"
            value={pilotSummary.paused}
            tone={pilotSummary.paused > 0 ? "amber" : "neutral"}
          />
        </ul>
        <Link
          href="/admin/pilots"
          className="mt-2 block text-xs text-default underline underline-offset-2 hover:text-default"
        >
          Open pilot tracker →
        </Link>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
          Conversation triggers
        </h2>
        <p className="mt-1 text-xs text-quiet">
          What to talk to which pilot about, today.
        </p>
        {triggers.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-line p-3 text-xs text-quiet">
            No triggers fired. Everyone is steady-state.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {triggers.map((trigger, i) => (
              <li
                key={`${trigger.kind}-${trigger.userId}-${i}`}
                className="rounded-lg border border-line bg-raised p-3 text-xs"
              >
                {trigger.kind === "debrief_50_checks" ? (
                  <>
                    <p className="font-medium text-strong">
                      Schedule a debrief
                    </p>
                    <p className="mt-1 text-quiet">
                      {trigger.email} ran {trigger.checks7d} checks in
                      the last 7 days.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-strong">
                      At-risk pilot
                    </p>
                    <p className="mt-1 text-quiet">
                      {trigger.email} ({trigger.plan}) hasn&rsquo;t run a
                      check in {trigger.daysIdle} days.
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function RailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "red" | "neutral";
}) {
  // Status dots map to the design system's four accent solids. The
  // neutral fallback uses accent-info-solid (blue) — the only token
  // that's both distinguishable from the urgency colors and not
  // already in use elsewhere on the row.
  const dot =
    tone === "green"
      ? "bg-accent-affirm"
      : tone === "amber"
        ? "bg-accent-caution"
        : tone === "red"
          ? "bg-accent-concern"
          : "bg-accent-info";
  return (
    <li className="flex items-center justify-between text-default">
      <span className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
        {label}
      </span>
      <span className="font-mono tabular-nums">{value}</span>
    </li>
  );
}

interface PilotSummary {
  active: number;
  amber: number;
  red: number;
  paused: number;
}

function summarizePilots(
  rows: Awaited<ReturnType<typeof loadPilotTracker>>,
): PilotSummary {
  let active = 0;
  let amber = 0;
  let red = 0;
  let paused = 0;
  for (const row of rows) {
    if (row.status === "green") active++;
    if (row.status === "amber") amber++;
    if (row.status === "red") red++;
    if (row.costPauseActive) paused++;
  }
  return { active, amber, red, paused };
}

// Pill primitive doesn't include purple; novel_pattern shares "info"
// semantics with the blue tone — distinguished by the label text.
function subtypePillTone(s: Subtype): PillTone {
  switch (s) {
    case "standards_conflict":
      return "red";
    case "ensemble_disagreement":
      return "amber";
    case "novel_pattern":
      return "blue";
    case "low_confidence":
    case "situation_ambiguity":
    case "out_of_distribution":
    default:
      return "neutral";
  }
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
