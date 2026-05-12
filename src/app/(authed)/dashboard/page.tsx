/**
 * /dashboard — account overview. Server-rendered so we can hit the DB
 * inline without a round-trip to a separate API endpoint.
 *
 * Section order (last reshuffle: 2026-04 IA refresh, design critique cycle):
 *   1. Header (email + plan pill)
 *   2. Try a check (inline ExplainClient, the hero)
 *   3. Usage this month (amber at ≥80%)
 *   4. This week (insights — the "what's worth looking at?" panel)
 *   5. Active surfaces (3-col grid, last-call timestamps)
 *   --- divider: work above, configuration below ---
 *   6. Subscription
 *   7. API key
 *   8. Team-tier surfaces (members, rules, overrides)
 *
 * Principle: work surfaces above the divider, configuration below.
 * Customers come back to do work, not to manage their account.
 * Try-a-check at the top serves both new users (touch the product
 * before installing) and returning users (one-off sanity check).
 * Usage + insights answer "am I about to hit a limit?" and "what
 * should I look at?" — those rise. API key is one-time-mint plus
 * occasional rotate; demoted below the work surfaces.
 */

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { tags } from "@/lib/cache-tags";
import { mintConsentToken } from "@/lib/consent-token";
import { asDate, rehydrateMappedDates } from "@/lib/date-rehydrate";
import { getDb, schema } from "@/db";
import {
  buildPatterns,
  loadFindingAggregates,
  type FindingPattern,
} from "@/lib/insight-patterns";
import { currentMonth, monthlyQuota, type Plan } from "@/lib/quotas";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { MotionList } from "@/components/motion-list";
import {
  ActiveSurfacesRowLive,
  type SurfaceActivity,
  type SurfaceKey,
} from "./active-surfaces-row-live";
import { ApiKeyPanel } from "./api-key-panel";
import { DashboardLivenessRefresher } from "./dashboard-liveness-refresher";
import { ExplainClient } from "./explain/explain-client";
import { FirstCallBanner } from "./first-call-banner";
import { RulesDisclosurePanel } from "./rules-disclosure-panel";
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
      <section className="rounded-lg border border-line p-6 text-sm">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const plan = user.plan as Plan;
  // Founder badge moved to dashboard/layout.tsx — the layout already
  // does its own isContentRXAdmin check, so the page body no longer
  // needs to compute it.
  const [seats, used, activeSub, sourceStats, insights, teamRuleCounts] =
    await Promise.all([
      loadSeats(user.id, plan, user.teamOwnerUserId),
      loadCurrentUsage(user.teamOwnerUserId ?? user.id),
      loadActiveSubscription(user.id, user.teamOwnerUserId),
      loadSourceStats(user.id, user.teamOwnerUserId),
      loadWeeklyInsights(user.id, user.teamOwnerUserId),
      loadTeamRuleCounts(user.id, user.teamOwnerUserId),
    ]);
  const surfaceActivity = sourceStats.activity;
  const activatedSource = sourceStats.recentlyActivated;
  const quota = monthlyQuota(plan, seats);
  // usedPct + usageTone derivation moved into UsagePanelLive (it owns
  // its own state now and recomputes when used/quota change).

  return (
    <>
      {/*
        Visibility-aware poll that calls router.refresh() every 5s while
        the tab is focused. Lets external surfaces (MCP, Figma plugin,
        CLI, GitHub Action, LSP) reflect on the dashboard without a
        manual page refresh. Renders nothing — kept outside the
        MotionList so the poll doesn't get a phantom motion wrapper.
      */}
      <DashboardLivenessRefresher />
      <MotionList className="flex flex-col gap-6">
        <FirstCallBanner source={activatedSource} />

        <header className="flex items-center justify-between">
          <div>
            <Eyebrow>Dashboard</Eyebrow>
            <h1 className="mt-2 text-2xl font-semibold">{user.email}</h1>
          </div>
          <PlanPill plan={plan} />
        </header>

        <TryACheckPanel plan={plan} />

        <RulesDisclosurePanel
          disabledCount={teamRuleCounts.disabled}
          customRuleCount={teamRuleCounts.custom}
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

        <InsightsPanel insights={insights} plan={plan} />

        <ActiveSurfacesRowLive
          surfaces={SURFACES}
          initialActivity={surfaceActivity}
        />

        {/*
          Section divider between Activity (work surfaces above —
          try-a-check, usage, insights, active surfaces) and Account
          (configuration below — subscription, API key, team links).
          The eyebrow names the boundary so the eye knows the
          next sections are settings, not more activity. Pairs with
          the secondary nav strip in dashboard/layout.tsx; sub-page
          navigation moved up there, freeing this body for two clear
          scenes: what's happening now, what you might touch monthly.
        */}
        <div className="mt-4 flex items-center gap-3" aria-hidden>
          <hr className="flex-1 border-line" />
          <span className="text-xs font-semibold uppercase tracking-widest text-quiet">
            Account
          </span>
          <hr className="flex-1 border-line" />
        </div>

        <SubscriptionPanel
          plan={plan}
          seats={seats}
          currentPeriodEnd={
            activeSub?.currentPeriodEnd
              ? activeSub.currentPeriodEnd.toISOString()
              : null
          }
          subscriptionStatus={activeSub?.status ?? null}
          cancelAtPeriodEnd={activeSub?.cancelAtPeriodEnd ?? false}
          // CARL consent token. Minted server-side on every /dashboard
          // render for free users (the only ones who see the upgrade
          // checkbox). Bound to user.id with a 15-minute TTL; single-use.
          // /api/checkout verifies it before stamping consent — the
          // body's "I agree" claim is no longer trusted on its own.
          consentToken={
            plan === "free"
              ? mintConsentToken({
                  userId: user.id,
                  action: "auto-renewal",
                })
              : null
          }
        />

        <ApiKeyPanel
          initialPrefix={user.apiKeyPrefix}
          initialCreatedAt={
            user.apiKeyCreatedAt ? user.apiKeyCreatedAt.toISOString() : null
          }
        />

        {plan === "team" && (
          <>
            <MembersLink />
            <TeamRulesLink />
            <OverridesLink />
          </>
        )}
      </MotionList>
    </>
  );
}

function TryACheckPanel({ plan }: { plan: Plan }) {
  return (
    // ExplainClient internally lays its sections out with space-y-6
    // (24px). The trailing privacy footnote previously sat at `mt-3`
    // (12px), which read smooshed against the inner rhythm — the
    // eye landed on a narrower-than-expected gap and read the
    // privacy line as crammed in. Bumped to mt-6 + a divider so the
    // privacy line reads as a deliberate footer outside the work
    // surface, not glued to the result block above it.
    <section className="rounded-lg border border-line p-5">
      <ExplainClient plan={plan} />
      <p className="mt-6 border-t border-line pt-5 text-xs text-quiet">
        Your checks are private until you flag them for review.
        ContentRX does not sell your checks or track you with cookies.{" "}
        <Link
          href="/privacy"
          className="underline underline-offset-2 hover:text-default"
        >
          How ContentRX handles your checks
        </Link>
      </p>
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

// Customer-likelihood order — the order a typical ICP discovers + adopts
// the surfaces, not the BUILD_PLAN_v2 surface-primacy order (which is
// the founder-side architectural ranking). Web app first because it's
// where the customer is when reading this card. Figma plugin second
// because content designers are a primary ICP and the plugin is their
// natural entry. MCP / CLI / GitHub Action are the engineer-side
// surfaces in approachability order. LSP last as the niche
// editor-extension surface.
//
// `key` matches the source enum on usage_events + violations (see
// src/lib/surfaces.ts). The `dashboard` key + "Web app" label is the
// one place enum-vs-label diverges; everywhere else key === lowercase
// label.
const SURFACES: ReadonlyArray<{
  key: SurfaceKey;
  label: string;
  installHref: string;
  installLabel: string;
}> = [
  // Web app — installHref points back to Try-a-check on this same
  // page so a fresh user gets a clear nudge to run their first check.
  { key: "dashboard", label: "Web app", installHref: "#try-a-check", installLabel: "Try a check" },
  {
    key: "plugin",
    label: "Figma plugin",
    installHref: "/install#figma",
    installLabel: "Install",
  },
  { key: "mcp", label: "MCP", installHref: "/install#mcp", installLabel: "Install" },
  { key: "cli", label: "CLI", installHref: "/install#cli", installLabel: "Install" },
  {
    key: "action",
    label: "GitHub Action",
    installHref: "/install#action",
    installLabel: "Install",
  },
  { key: "lsp", label: "LSP", installHref: "/install#lsp", installLabel: "Install" },
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
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-strong">This week</h2>
        <span className="text-xs text-default">Last 7 days</span>
      </header>
      {!hasActivity ? (
        <p className="text-sm text-default">
          Nothing flagged yet this week. Run a check above or wire a
          surface to start seeing patterns. Insights show up after your
          first few checks.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-default">
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
            <p className="text-default">
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
            <ul className="flex list-disc flex-col gap-1 pl-5 text-default">
              {insights.patterns.map((p, i) => (
                <li key={`${p.kind}-${i}`}>
                  <PatternLine pattern={p} />
                </li>
              ))}
            </ul>
          )}
          {plan === "team" && insights.overrides >= 5 && (
            <p className="rounded-md border border-accent-caution-border bg-accent-caution-soft px-3 py-2 text-xs text-accent-caution-text">
              Your team is dismissing findings often. Rule patterns
              breaks down which rules your team disagrees with most.
              Consider tuning them in team rules.
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            {plan === "team" && (
              <Link
                href="/dashboard/overrides"
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                View rule patterns
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
        <code className="rounded bg-sunken px-1 py-0.5 text-xs">
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

function MembersLink() {
  return (
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-strong">Members</h2>
      </header>
      <p className="mb-3 text-sm text-default">
        Invite teammates by email. They&apos;ll share the team&apos;s
        monthly check limit and custom rules.
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
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-strong">Rule patterns</h2>
        <span className="text-xs text-default">Last 30 days</span>
      </header>
      <p className="mb-3 text-sm text-default">
        The rules your team dismisses most. Use this to decide which
        rules to tune or disable in team rules.
      </p>
      <Link
        href="/dashboard/overrides"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        View rule patterns
      </Link>
    </section>
  );
}

function TeamRulesLink() {
  return (
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-strong">Team rules</h2>
      </header>
      <p className="mb-3 text-sm text-default">
        Disable a built-in rule or add your own. Changes apply to every
        evaluation your team runs.
      </p>
      <Link
        href="/dashboard/rules"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        Edit team rules
      </Link>
    </section>
  );
}

/** Count disabled standards + custom team rules for the current
 * user's team-owner pivot. Powers the dashboard's RulesDisclosurePanel
 * (Phase 7) — Free / Pro / Scale users see zeros (they can't edit
 * team rules); Team users see whatever their owner has configured. */
async function loadTeamRuleCounts(
  userId: string,
  teamOwnerUserId: string | null,
): Promise<{ disabled: number; custom: number }> {
  const ownerId = teamOwnerUserId ?? userId;
  const db = getDb();
  const rows = await db
    .select({ action: schema.teamRules.action })
    .from(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, ownerId));
  let disabled = 0;
  let custom = 0;
  for (const row of rows) {
    if (row.action === "disable") disabled++;
    if (row.action === "add") custom++;
  }
  return { disabled, custom };
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
  cancelAtPeriodEnd: boolean;
} | null> {
  const ownerId = teamOwnerUserId ?? userId;
  const cached = await unstable_cache(
    async (id: string) => {
      const db = getDb();
      const [row] = await db
        .select({
          status: schema.subscriptions.status,
          currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
          cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
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
    cancelAtPeriodEnd: cached.cancelAtPeriodEnd ?? false,
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
      // Query usage_events, not violations. Every successful /api/check
      // writes one usage_events row regardless of verdict; violations
      // rows only land when the engine flagged something. A surface
      // that ran a clean PR (e.g., a GitHub Action seeing "All clear"
      // on a PR with no findings) needs to count as connected too.
      // Closes the bug where the GitHub Action card stayed
      // "Not connected" after a real run because none of its strings
      // got flagged.
      const rows = (await db
        .select({
          source: schema.usageEvents.source,
          count: sql<number>`count(*)::int`,
          firstAt: sql<Date>`min(${schema.usageEvents.createdAt})`,
          lastAt: sql<Date>`max(${schema.usageEvents.createdAt})`,
        })
        .from(schema.usageEvents)
        .where(eq(schema.usageEvents.teamId, id))
        .groupBy(schema.usageEvents.source)) as Array<{
        source: string | null;
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
        if (r.source == null || !(r.source in activity)) continue;
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
    // tags.violations is the "after every check" invalidation tag —
    // /api/check calls revalidateDashboard which fires this regardless
    // of whether a violation was recorded. So the cache refreshes on
    // every API call, which is what we want now that the query reads
    // from usage_events (one row per check, verdict-agnostic).
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
  // Free: muted neutral. Pro: emerald (the brand accent — Pro IS the
  // primary subscription). Team: emerald too, distinguished by the
  // seat count rendered next to it on the subscription panel rather
  // than by hue. Keeping plan colors close to each other makes the
  // accent system feel coherent rather than "every plan a new color."
  const tone =
    plan === "free" ? "neutral" : plan === "pro" ? "emerald" : "emerald";
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);
  return <Pill tone={tone}>{label}</Pill>;
}
