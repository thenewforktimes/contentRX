/**
 * /dashboard/overrides — Team-plan override-rate report.
 *
 * Server component, no client-side fetch. Reads aggregate counts from
 * `violation_overrides` directly via Drizzle so the page renders in one
 * round-trip with no client JS budget.
 *
 * Plan-gated: Free/Pro → upsell card; Team → the report (any team
 * member, not just the owner — Position-3 product direction, Apr 2026).
 *
 * BUILD_PLAN_v2 Session 11.
 */

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import {
  summarizeQuadrants,
  type BehaviorQuadrant,
} from "@/lib/behavior-quadrant";
import { aggregateOverrides } from "@/lib/session-aggregation";
import { CATEGORIES, STANDARDS_BY_ID } from "@/lib/standards";
import { getOrProvisionUser } from "@/lib/user-provisioning";

const UNKNOWN_CATEGORY = "Other";

const CATEGORY_NAMES_BY_ID: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.name]),
);

function categoryNameFor(standardId: string): string {
  const std = STANDARDS_BY_ID[standardId];
  if (!std) return UNKNOWN_CATEGORY;
  return CATEGORY_NAMES_BY_ID[std.category] ?? UNKNOWN_CATEGORY;
}

const RANGE_DAYS = 30;

export default async function OverridesPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/overrides");
  }

  const db = getDb();
  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-line p-6 text-sm">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  if (user.plan !== "team") {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-line p-6">
        <h1 className="text-lg font-semibold">Rule patterns</h1>
        <p className="text-sm text-default">
          Available on the Team plan. Surfaces the rules your team
          disagrees with most so you can disable or tune them in team
          rules.
        </p>
        <Link href="/dashboard" className={buttonStyles({ size: "sm" })}>
          Upgrade to Team
        </Link>
      </section>
    );
  }

  const teamId = user.teamOwnerUserId ?? user.id;
  const since = new Date(Date.now() - RANGE_DAYS * 24 * 60 * 60 * 1000);

  const [{ overrides_count = 0 } = { overrides_count: 0 }] = (await db
    .select({ overrides_count: sql<number>`count(*)::int` })
    .from(schema.violationOverrides)
    .where(
      and(
        eq(schema.violationOverrides.teamId, teamId),
        gte(schema.violationOverrides.createdAt, since),
      ),
    )) as Array<{ overrides_count: number }>;

  const [{ violations_count = 0 } = { violations_count: 0 }] = (await db
    .select({ violations_count: sql<number>`count(*)::int` })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamId),
        gte(schema.violations.createdAt, since),
      ),
    )) as Array<{ violations_count: number }>;

  const overrideRate =
    violations_count > 0
      ? Math.round((overrides_count / violations_count) * 1000) / 10
      : null;

  const rawStandardCounts = (await db
    .select({
      standard_id: schema.violationOverrides.standardId,
      moment: schema.violationOverrides.moment,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violationOverrides)
    .where(
      and(
        eq(schema.violationOverrides.teamId, teamId),
        gte(schema.violationOverrides.createdAt, since),
      ),
    )
    .groupBy(
      schema.violationOverrides.standardId,
      schema.violationOverrides.moment,
    )
    .orderBy(desc(sql`count(*)`))) as Array<{
    standard_id: string;
    moment: string | null;
    count: number;
  }>;

  const categoryTotals = new Map<string, { category: string; moment: string | null; count: number }>();
  for (const row of rawStandardCounts) {
    const category = categoryNameFor(row.standard_id);
    const key = `${category}|${row.moment ?? ""}`;
    const existing = categoryTotals.get(key);
    if (existing) {
      existing.count += row.count;
    } else {
      categoryTotals.set(key, { category, moment: row.moment, count: row.count });
    }
  }
  const topCategories = Array.from(categoryTotals.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const byType = (await db
    .select({
      override_type: schema.violationOverrides.overrideType,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violationOverrides)
    .where(
      and(
        eq(schema.violationOverrides.teamId, teamId),
        gte(schema.violationOverrides.createdAt, since),
      ),
    )
    .groupBy(schema.violationOverrides.overrideType)
    .orderBy(desc(sql`count(*)`))) as Array<{
    override_type: string;
    count: number;
  }>;

  // Session 3 — pull the raw behavior signals so we can tally the
  // four-quadrant model server-side. Only rows with stance captured
  // contribute meaningful quadrant data; pre-Session-3 rows fall into
  // `unknown`.
  const quadrantRows = (await db
    .select({
      stance: schema.violationOverrides.overrideStance,
      rationaleExpanded: schema.violationOverrides.rationaleExpanded,
      timeToActionMs: schema.violationOverrides.timeToActionMs,
    })
    .from(schema.violationOverrides)
    .where(
      and(
        eq(schema.violationOverrides.teamId, teamId),
        gte(schema.violationOverrides.createdAt, since),
      ),
    )) as Array<{
    stance: "agree" | "disagree" | "agree_but_overriding" | null;
    rationaleExpanded: boolean | null;
    timeToActionMs: number | null;
  }>;

  const quadrantCounts = summarizeQuadrants(quadrantRows);

  // Session 4 — pull per-row ids + session_id so we can collapse
  // same-standard-same-session clusters into standard_pushback rows
  // in the review queue.
  const recentRows = (await db
    .select({
      id: schema.violationOverrides.id,
      userId: schema.violationOverrides.userId,
      standardId: schema.violationOverrides.standardId,
      sessionId: schema.violationOverrides.sessionId,
      createdAt: schema.violationOverrides.createdAt,
    })
    .from(schema.violationOverrides)
    .where(
      and(
        eq(schema.violationOverrides.teamId, teamId),
        gte(schema.violationOverrides.createdAt, since),
      ),
    )) as Array<{
    id: string;
    userId: string;
    standardId: string;
    sessionId: string | null;
    createdAt: Date;
  }>;

  const { pushbacks } = aggregateOverrides(recentRows);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
          Last {RANGE_DAYS} days
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Rule patterns</h1>
        <p className="mt-1 text-sm text-default">
          The rules your team dismisses most. Use this to decide which
          standards to disable or tune in your{" "}
          <Link
            href="/dashboard/rules"
            className="underline underline-offset-2"
          >
            team rules
          </Link>
          .
        </p>
      </header>

      <section className="grid grid-cols-3 gap-4">
        <Stat label="Overrides" value={overrides_count.toLocaleString()} />
        <Stat
          label="Findings in window"
          value={violations_count.toLocaleString()}
        />
        <Stat
          label="Override rate"
          value={
            overrideRate === null
              ? "n/a"
              : `${overrideRate.toLocaleString()}%`
          }
          tone={
            overrideRate !== null && overrideRate > 25 ? "warn" : "default"
          }
        />
      </section>

      {overrides_count === 0 ? (
        <section className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-quiet">
          Nothing to show yet. Your team hasn&apos;t dismissed any
          findings. Dismissals from the Figma plugin or{" "}
          <code className="rounded bg-raised px-1 py-0.5 font-mono text-xs">
            /contentrx ignore &lt;STD&gt;
          </code>{" "}
          comments on PRs land here, so you can decide which rules to
          tune.
        </section>
      ) : (
        <>
          {pushbacks.length > 0 && (
            <section>
              <h2 className="mb-1 text-sm font-semibold">Pushbacks</h2>
              <p className="mb-3 text-xs text-default">
                Clusters of 3+ overrides on the same rule inside a
                single session (scan, CI run, dashboard session).
                Strongest signal that a rule needs a look in your{" "}
                <Link
                  href="/dashboard/rules"
                  className="underline underline-offset-2"
                >
                  team rules
                </Link>
                .
              </p>
              <ul className="flex flex-col gap-2">
                {pushbacks.map((p) => (
                  <li
                    key={p.key}
                    className="flex items-start justify-between gap-4 rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
                  >
                    <div>
                      <p className="text-xs font-medium">
                        {categoryNameFor(p.standardId)}
                      </p>
                      <p className="text-xs text-default">
                        Session{" "}
                        <code className="font-mono">
                          {p.sessionKey.startsWith("pseudo:")
                            ? "(inferred)"
                            : p.sessionKey}
                        </code>{" "}
                        · {p.firstAt.toLocaleString()}
                      </p>
                    </div>
                    <Pill tone="amber" className="shrink-0">
                      {p.count}× pushback
                    </Pill>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold">
              Most-overridden categories
            </h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-quiet">
                  <th className="py-2">Category</th>
                  <th className="py-2">Moment</th>
                  <th className="py-2 text-right">Overrides</th>
                </tr>
              </thead>
              <tbody>
                {topCategories.map((s) => (
                  <tr
                    key={`${s.category}|${s.moment ?? ""}`}
                    className="border-b border-line"
                  >
                    <td className="py-2 text-xs">{s.category}</td>
                    <td className="py-2 text-xs text-default">
                      {s.moment ?? "n/a"}
                    </td>
                    <td className="py-2 text-right">
                      {s.count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">By dismissal type</h2>
            <ul className="flex flex-col gap-2">
              {byType.map((t) => (
                <li
                  key={t.override_type}
                  className="flex items-center justify-between rounded-md border border-line p-3 text-sm"
                >
                  <span className="font-mono text-xs">{t.override_type}</span>
                  <span className="font-medium">
                    {t.count.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold">
              How your team engaged
            </h2>
            <p className="mb-3 text-xs text-default">
              Each finding falls into one of four buckets, depending on
              whether your teammate read the rationale before deciding
              and whether they agreed or disagreed. Hover any row for
              a definition.
            </p>
            <ul className="grid grid-cols-2 gap-2">
              {QUADRANT_ORDER.map((q) => (
                <li
                  key={q}
                  title={QUADRANT_TOOLTIPS[q]}
                  className="flex items-center justify-between rounded-md border border-line p-3 text-sm"
                >
                  <span className="text-xs">{QUADRANT_LABELS[q]}</span>
                  <span className="font-medium">
                    {quadrantCounts[q].toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

const QUADRANT_ORDER: readonly BehaviorQuadrant[] = [
  "informed_reject",
  "informed_accept",
  "pattern_match_accept",
  "reflex_reject",
  "unknown",
] as const;

const QUADRANT_LABELS: Record<BehaviorQuadrant, string> = {
  informed_reject: "Read it, disagreed",
  informed_accept: "Read it, agreed",
  pattern_match_accept: "Skimmed it, agreed",
  reflex_reject: "Skimmed it, disagreed",
  unknown: "Older entries (no engagement data)",
};

const QUADRANT_TOOLTIPS: Record<BehaviorQuadrant, string> = {
  informed_reject:
    "Teammate read the rationale and still pushed back. Highest-information signal: these are the cases worth investigating in team rules.",
  informed_accept:
    "Teammate read the rationale and accepted the finding. Confirms the rule landed correctly.",
  pattern_match_accept:
    "Teammate accepted without reading the rationale. Likely an obvious case where the rule fired correctly.",
  reflex_reject:
    "Teammate dismissed without reading the rationale. May indicate a rule that's miscalibrated for your team's voice.",
  unknown:
    "Older entries logged before we tracked engagement signal. Won't appear for new dismissals.",
};

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  const valueColor =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-300"
      : "text-strong";
  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-xs uppercase tracking-wider text-quiet">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}
