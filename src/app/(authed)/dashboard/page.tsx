/**
 * /dashboard — account overview. Server-rendered so we can hit the DB
 * inline without a round-trip to a separate API endpoint.
 *
 * Section order (Apr 2026 inversion + PR-16/17):
 *   1. Header (email + plan pill)
 *   2. Try a check (inline ExplainClient, the hero)
 *   3. API key
 *   4. Usage (amber at ≥80%)
 *   5. Active surfaces row (last-call timestamp per source)
 *   6. Subscription
 *   7. Team-tier surfaces
 *   8. Calibration
 *
 * Try-a-check at the top serves both new users (touch the product
 * before installing) and returning users (one-off "let me sanity-check
 * this string"). Active surfaces row is the "are my integrations
 * alive?" surface — the dashboard's primary job post-MCP-shift.
 */

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { tags } from "@/lib/cache-tags";
import { asDate, rehydrateMappedDates } from "@/lib/date-rehydrate";
import { getDb, schema } from "@/db";
import {
  buildPatterns,
  loadFindingAggregates,
  type FindingPattern,
} from "@/lib/insight-patterns";
import { currentMonth, monthlyQuota, type Plan } from "@/lib/quotas";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import {
  ActiveSurfacesRowLive,
  type SurfaceActivity,
  type SurfaceKey,
} from "./active-surfaces-row-live";
import { ApiKeyPanel } from "./api-key-panel";
import { DashboardLivenessRefresher } from "./dashboard-liveness-refresher";
import { ExplainClient } from "./explain/explain-client";
import { FirstCallBanner } from "./first-call-banner";
import { SubscriptionPanel } from "./subscription-panel";
import { UsagePanelLive } from "./usage-panel-live";

const INSIGHTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// nextMonthReset() lived here when UsagePanel was inline. Now that
// UsagePanel was extracted to ./usage-panel-live.tsx (Client Component
// for optimistic updates), the helper lives there too.

export default async function DashboardPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard");
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-neutral-200 p-6 text-sm dark:border-neutral-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const plan = user.plan as Plan;
  const [seats, used, activeSub, sourceStats, insights] =
    await Promise.all([
      loadSeats(user.id, plan, user.teamOwnerUserId),
      loadCurrentUsage(user.id),
      loadActiveSubscription(user.id, user.teamOwnerUserId),
      loadSourceStats(user.id, user.teamOwnerUserId),
      loadWeeklyInsights(user.id, user.teamOwnerUserId),
    ]);
  const surfaceActivity = sourceStats.activity;
  const activatedSource = sourceStats.recentlyActivated;
  const quota = monthlyQuota(plan, seats);
  // usedPct + usageTone derivation moved into UsagePanelLive (it owns
  // its own state now and recomputes when used/quota change).

  return (
    <div className="flex flex-col gap-6">
      {/*
        Visibility-aware poll that calls router.refresh() every 5s while
        the tab is focused. Lets external surfaces (MCP, Figma plugin,
        CLI, GitHub Action, LSP) reflect on the dashboard without a
        manual page refresh. Renders nothing.
      */}
      <DashboardLivenessRefresher />
      <FirstCallBanner source={activatedSource} />

      <header className="flex items-center justify-between">
        <div>
          <Eyebrow>Dashboard</Eyebrow>
          <h1 className="mt-2 text-2xl font-semibold">{user.email}</h1>
        </div>
        <PlanPill plan={plan} />
      </header>

      <TryACheckPanel />

      <ApiKeyPanel
        initialPrefix={user.apiKeyPrefix}
        initialCreatedAt={
          user.apiKeyCreatedAt ? user.apiKeyCreatedAt.toISOString() : null
        }
      />

      {/*
        UsagePanelLive + ActiveSurfacesRowLive are Client Components
        that take server-rendered initial values AND listen for the
        cx-check-completed window event dispatched by ExplainClient.
        After a check, the counter and Web app surface card jump
        immediately from the response payload instead of waiting
        ~200ms for router.refresh() to round-trip new HTML. The
        server-authoritative values still flow in via re-render and
        overwrite the optimistic state when they arrive.
      */}
      <UsagePanelLive initialUsed={used} initialQuota={quota} />

      <ActiveSurfacesRowLive
        surfaces={SURFACES}
        initialActivity={surfaceActivity}
      />

      <InsightsPanel insights={insights} plan={plan} />

      <SubscriptionPanel
        plan={plan}
        seats={seats}
        currentPeriodEnd={
          activeSub?.currentPeriodEnd
            ? activeSub.currentPeriodEnd.toISOString()
            : null
        }
        subscriptionStatus={activeSub?.status ?? null}
      />

      {plan === "team" && (
        <>
          <MembersLink />
          <TeamRulesLink />
          <OverridesLink />
        </>
      )}

      <CalibrateLink optedOut={user.preferenceOptedOutAt !== null} />
    </div>
  );
}

function TryACheckPanel() {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Try a check</h2>
        <span className="text-xs text-neutral-500 dark:text-neutral-300">
          Paste any UI string · 1 check
        </span>
      </header>
      <ExplainClient />
    </section>
  );
}

// UsagePanel was extracted to ./usage-panel-live.tsx as a Client
// Component that listens for cx-check-completed events. See that file
// for the optimistic-update logic.
//
// SurfaceKey + SurfaceActivity types live in ./active-surfaces-row-live.tsx
// and are imported above. Single source of truth so the loader and the
// renderer stay in lockstep.

const SURFACES: ReadonlyArray<{
  key: SurfaceKey;
  label: string;
  installHref: string;
  installLabel: string;
}> = [
  // Web app first — it's the surface the user is currently in. The
  // installHref points back to the Try-a-check form on this same page
  // so a fresh user gets a clear nudge to run their first check. The
  // enum value is "dashboard" (matches violation_overrides + correction
  // tables); the user-facing label is "Web app".
  { key: "dashboard", label: "Web app", installHref: "#try-a-check", installLabel: "Try a check" },
  { key: "mcp", label: "MCP", installHref: "/install#mcp", installLabel: "Install" },
  { key: "lsp", label: "LSP", installHref: "/install#lsp", installLabel: "Install" },
  {
    key: "action",
    label: "GitHub Action",
    installHref: "/install#action",
    installLabel: "Install",
  },
  {
    key: "plugin",
    label: "Figma plugin",
    installHref: "/install#figma",
    installLabel: "Install",
  },
  { key: "cli", label: "CLI", installHref: "/install#cli", installLabel: "Install" },
];

// ActiveSurfacesRow + SurfaceCard + formatRelative were extracted to
// ./active-surfaces-row-live.tsx as a Client Component that increments
// the matching surface's count + sets lastAt = now optimistically when
// a check fires. See that file for the optimistic-update logic.

type WeeklyInsights = {
  violations: number;
  overrides: number;
  overrideRatePct: number | null;
  topSourceLabel: string | null;
  topSourceCount: number;
  patterns: FindingPattern[];
};

function InsightsPanel({
  insights,
  plan,
}: {
  insights: WeeklyInsights;
  plan: Plan;
}) {
  const hasActivity = insights.violations > 0 || insights.overrides > 0;
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">This week</h2>
        <span className="text-xs text-neutral-500 dark:text-neutral-300">Last 7 days</span>
      </header>
      {!hasActivity ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Nothing flagged yet this week. Run a check above or wire a
          surface to start seeing patterns. Insights show up after your
          first few checks.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-neutral-700 dark:text-neutral-300">
            <span className="font-semibold">{insights.violations.toLocaleString()}</span>{" "}
            {insights.violations === 1 ? "finding" : "findings"} flagged.{" "}
            {insights.overrides > 0 && (
              <>
                <span className="font-semibold">
                  {insights.overrides.toLocaleString()}
                </span>{" "}
                dismissed
                {insights.overrideRatePct !== null && (
                  <> ({insights.overrideRatePct}% override rate)</>
                )}
                .
              </>
            )}
          </p>
          {insights.topSourceLabel && (
            <p className="text-neutral-700 dark:text-neutral-300">
              Most-active surface:{" "}
              <span className="font-medium">{insights.topSourceLabel}</span>
              {" "}with{" "}
              <span className="tabular-nums">
                {insights.topSourceCount.toLocaleString()}
              </span>
              {" "}{insights.topSourceCount === 1 ? "finding" : "findings"}.
            </p>
          )}
          {insights.patterns.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-neutral-700 dark:text-neutral-300">
              {insights.patterns.map((p, i) => (
                <li key={`${p.kind}-${i}`}>
                  <PatternLine pattern={p} />
                </li>
              ))}
            </ul>
          )}
          {plan === "team" && insights.overrides >= 5 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Your team is dismissing findings often. The override report
              breaks down which rules your team disagrees with most —
              consider tuning them in team rules.
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            {plan === "team" && (
              <Link
                href="/dashboard/overrides"
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                View override report
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Renders one cross-finding callout. Phrasing is tuned to be observation
 * (not prescription) — "X% landed on confirmations" gives the user a
 * fact about their week, not a directive. They can decide what to do
 * with it. Avoids the "you should fix X" trap that turns insights into
 * nagging.
 */
function PatternLine({ pattern }: { pattern: FindingPattern }) {
  if (pattern.kind === "moment-concentration") {
    return (
      <>
        <span className="font-medium">{pattern.momentLabel}</span>
        {" "}drew{" "}
        <span className="tabular-nums">{pattern.sharePct}%</span>
        {" "}of findings (
        <span className="tabular-nums">{pattern.count.toLocaleString()}</span>
        ).
      </>
    );
  }
  if (pattern.kind === "file-hotspot") {
    return (
      <>
        Same file flagged most:{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">
          {pattern.filePath}
        </code>{" "}
        (
        <span className="tabular-nums">{pattern.count.toLocaleString()}</span>{" "}
        {pattern.count === 1 ? "finding" : "findings"}).
      </>
    );
  }
  return (
    <>
      <span className="tabular-nums">{pattern.highCount.toLocaleString()}</span>
      {" "}of{" "}
      <span className="tabular-nums">{pattern.total.toLocaleString()}</span>
      {" "}findings are high-severity (
      <span className="tabular-nums">{pattern.sharePct}%</span>
      ).
    </>
  );
}

function CalibrateLink({ optedOut }: { optedOut: boolean }) {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Calibration</h2>
        <span className="text-xs text-neutral-500 dark:text-neutral-300">
          {optedOut ? "Opted out" : "Weekly · 60 sec"}
        </span>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
        Three pairwise judgment prompts a week, optional. Picks feed
        the human-judgment signal behind the content model.
      </p>
      <Link
        href="/dashboard/calibrate"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {optedOut ? "Manage calibration settings" : "Start calibration"}
      </Link>
    </section>
  );
}

function MembersLink() {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Members</h2>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
        Invite teammates by email. They&apos;ll share the team&apos;s
        monthly check limit, custom rules, and custom examples.
      </p>
      <Link
        href="/dashboard/members"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        Manage members
      </Link>
    </section>
  );
}

function OverridesLink() {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Override report</h2>
        <span className="text-xs text-neutral-500 dark:text-neutral-300">Last 30 days</span>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
        The rules your team dismisses most. Use this to decide which
        rules to tune or disable in team rules.
      </p>
      <Link
        href="/dashboard/overrides"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        View override report
      </Link>
    </section>
  );
}

function TeamRulesLink() {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Team rules</h2>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
        Disable a built-in rule or add your own. Changes apply to every
        evaluation your team runs.
      </p>
      <Link
        href="/dashboard/team/rules"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        Edit team rules
      </Link>
    </section>
  );
}

async function loadSeats(
  userId: string,
  plan: Plan,
  teamOwnerUserId: string | null,
): Promise<number> {
  if (plan !== "team") return 1;
  const ownerId = teamOwnerUserId ?? userId;
  return unstable_cache(
    async (id: string) => {
      const db = getDb();
      const [sub] = await db
        .select({ seats: schema.subscriptions.seats })
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.userId, id),
            eq(schema.subscriptions.plan, "team"),
          ),
        )
        .limit(1);
      return sub?.seats ?? 1;
    },
    [`loadSeats:${ownerId}`],
    { tags: [tags.subscription(ownerId)] },
  )(ownerId);
}

async function loadActiveSubscription(
  userId: string,
  teamOwnerUserId: string | null,
): Promise<{
  status: string;
  currentPeriodEnd: Date | null;
} | null> {
  const ownerId = teamOwnerUserId ?? userId;
  const cached = await unstable_cache(
    async (id: string) => {
      const db = getDb();
      const [row] = await db
        .select({
          status: schema.subscriptions.status,
          currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
        })
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.userId, id),
            inArray(schema.subscriptions.status, [
              "active",
              "trialing",
              "past_due",
            ]),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    [`loadActiveSubscription:${ownerId}`],
    { tags: [tags.subscription(ownerId)] },
  )(ownerId);
  if (!cached) return null;
  // unstable_cache serializes Dates to ISO strings on cache hits;
  // asDate() rehydrates so the page-level call to
  // `activeSub.currentPeriodEnd.toISOString()` always sees a real Date.
  // See src/lib/date-rehydrate.ts for the contract.
  return {
    status: cached.status,
    currentPeriodEnd: asDate(cached.currentPeriodEnd),
  };
}

async function loadCurrentUsage(userId: string): Promise<number> {
  // Cache key includes the month so the December → January roll-over
  // doesn't read stale data: each month has its own usage row + tag.
  const month = currentMonth();
  return unstable_cache(
    async (id: string, m: string) => {
      const db = getDb();
      const [row] = await db
        .select({ count: schema.usage.count })
        .from(schema.usage)
        .where(
          and(eq(schema.usage.userId, id), eq(schema.usage.month, m)),
        )
        .limit(1);
      return row?.count ?? 0;
    },
    [`loadCurrentUsage:${userId}:${month}`],
    { tags: [tags.usage(userId)] },
  )(userId, month);
}

/**
 * Single per-source aggregate: count, first-seen, last-seen. One scan
 * powers BOTH the Active-surfaces row (count + lastAt) and the
 * FirstCallBanner (recently-activated = firstAt within 7d window).
 *
 * Scoped to the team (teamId = teamOwnerUserId for members,
 * user.id for owners). Returns a complete record with zero-counts for
 * surfaces never used — the renderer can lay out all five cards.
 */
async function loadSourceStats(
  userId: string,
  teamOwnerUserId: string | null,
): Promise<{
  activity: SurfaceActivity;
  recentlyActivated: SurfaceKey | null;
}> {
  const teamId = teamOwnerUserId ?? userId;
  // Hourly revalidation handles the moving "recently activated" window
  // even when no new violations arrive to bust the tag. Tag invalidation
  // covers the data-changes path; the timer covers the time-changes
  // path. Whichever fires first refreshes the cache.
  const cached = await unstable_cache(
    async (id: string) => {
      const db = getDb();
      const rows = (await db
        .select({
          source: schema.violations.source,
          count: sql<number>`count(*)::int`,
          firstAt: sql<Date>`min(${schema.violations.createdAt})`,
          lastAt: sql<Date>`max(${schema.violations.createdAt})`,
        })
        .from(schema.violations)
        .where(eq(schema.violations.teamId, id))
        .groupBy(schema.violations.source)) as Array<{
        source: string;
        count: number;
        firstAt: Date;
        lastAt: Date;
      }>;

      const activity: SurfaceActivity = {
        dashboard: { count: 0, lastAt: null },
        mcp: { count: 0, lastAt: null },
        lsp: { count: 0, lastAt: null },
        action: { count: 0, lastAt: null },
        plugin: { count: 0, lastAt: null },
        cli: { count: 0, lastAt: null },
      };
      const since = new Date(Date.now() - ACTIVATION_WINDOW_MS);
      let recentlyActivated: { source: SurfaceKey; firstAt: Date } | null =
        null;

      for (const r of rows) {
        if (!(r.source in activity)) continue;
        const surface = r.source as SurfaceKey;
        const firstAt =
          r.firstAt instanceof Date ? r.firstAt : new Date(r.firstAt);
        const lastAt =
          r.lastAt instanceof Date ? r.lastAt : new Date(r.lastAt);
        activity[surface] = { count: r.count, lastAt };
        if (
          firstAt >= since &&
          (!recentlyActivated || firstAt > recentlyActivated.firstAt)
        ) {
          recentlyActivated = { source: surface, firstAt };
        }
      }
      return { activity, recentlyActivated: recentlyActivated?.source ?? null };
    },
    [`loadSourceStats:${teamId}`],
    { tags: [tags.violations(teamId)], revalidate: 3600 },
  )(teamId);
  // unstable_cache JSON-serializes Dates back to ISO strings on cache
  // hits; rehydrateMappedDates rebuilds activity[*].lastAt as real Date
  // instances so consumers (formatRelative, etc.) don't crash with
  // "TypeError: a.getTime is not a function". See src/lib/date-rehydrate.ts.
  return {
    activity: rehydrateMappedDates(
      cached.activity,
      "lastAt",
    ) as SurfaceActivity,
    recentlyActivated: cached.recentlyActivated,
  };
}

/**
 * Aggregate counts for the "This week" insights panel.
 *
 * Deliberately surfaces team-aggregate metrics only — counts of
 * findings / dismissals + override rate + which surface is most
 * active. Does NOT expose `standard_id` per the schema-2.0.0 lock;
 * the per-standard breakdown lives on /dashboard/overrides where
 * standard IDs are user-data (the user's own override actions).
 */
async function loadWeeklyInsights(
  userId: string,
  teamOwnerUserId: string | null,
): Promise<WeeklyInsights> {
  const teamId = teamOwnerUserId ?? userId;
  return unstable_cache(
    async (id: string) => {
      const since = new Date(Date.now() - INSIGHTS_WINDOW_MS);
      const db = getDb();

      const [violationsCount, overridesCount, topSource, patternAggregates] =
        await Promise.all([
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.violations)
            .where(
              and(
                eq(schema.violations.teamId, id),
                gte(schema.violations.createdAt, since),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.violationOverrides)
            .where(
              and(
                eq(schema.violationOverrides.teamId, id),
                gte(schema.violationOverrides.createdAt, since),
              ),
            ),
          db
            .select({
              source: schema.violations.source,
              count: sql<number>`count(*)::int`,
            })
            .from(schema.violations)
            .where(
              and(
                eq(schema.violations.teamId, id),
                gte(schema.violations.createdAt, since),
              ),
            )
            .groupBy(schema.violations.source)
            .orderBy(desc(sql`count(*)`))
            .limit(1),
          loadFindingAggregates(id, since),
        ]);

      const violations = violationsCount[0]?.count ?? 0;
      const overrides = overridesCount[0]?.count ?? 0;
      const overrideRatePct =
        violations > 0
          ? Math.round((overrides / violations) * 1000) / 10
          : null;

      const topSourceRow = topSource[0];
      const topSourceLabel = topSourceRow
        ? sourceLabel(topSourceRow.source)
        : null;
      const topSourceCount = topSourceRow?.count ?? 0;

      const patterns = buildPatterns(patternAggregates, violations);

      return {
        violations,
        overrides,
        overrideRatePct,
        topSourceLabel,
        topSourceCount,
        patterns,
      };
    },
    [`loadWeeklyInsights:${teamId}`],
    { tags: [tags.violations(teamId)], revalidate: 3600 },
  )(teamId);
}

function sourceLabel(source: string): string {
  switch (source) {
    case "mcp":
      return "MCP";
    case "lsp":
      return "LSP";
    case "action":
      return "GitHub Action";
    case "plugin":
      return "Figma plugin";
    case "cli":
      return "CLI";
    default:
      return source;
  }
}

function PlanPill({ plan }: { plan: Plan }) {
  const styles: Record<Plan, string> = {
    free: "bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
    pro: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    team: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  };
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${styles[plan]}`}
    >
      {label}
    </span>
  );
}
