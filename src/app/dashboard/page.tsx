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
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import {
  buildPatterns,
  loadFindingAggregates,
  type FindingPattern,
} from "@/lib/insight-patterns";
import { currentMonth, monthlyQuota, type Plan } from "@/lib/quotas";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { ApiKeyPanel } from "./api-key-panel";
import { ExplainClient } from "./explain/explain-client";
import { FirstCallBanner } from "./first-call-banner";
import { SubscriptionPanel } from "./subscription-panel";

const USAGE_WARNING_THRESHOLD = 0.8;
const INSIGHTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function nextMonthReset(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return next.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

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
  const [seats, used, activeSub, surfaceActivity, insights, activatedSource] =
    await Promise.all([
      loadSeats(user.id, plan, user.teamOwnerUserId),
      loadCurrentUsage(user.id),
      loadActiveSubscription(user.id, user.teamOwnerUserId),
      loadSurfaceActivity(user.id, user.teamOwnerUserId),
      loadWeeklyInsights(user.id, user.teamOwnerUserId),
      loadRecentlyActivatedSurface(user.id, user.teamOwnerUserId),
    ]);
  const quota = monthlyQuota(plan, seats);
  const usedPct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const usageTone: UsageTone =
    used >= quota ? "exhausted" : used >= quota * USAGE_WARNING_THRESHOLD ? "warn" : "ok";

  return (
    <div className="flex flex-col gap-6">
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

      <UsagePanel
        used={used}
        quota={quota}
        usedPct={usedPct}
        tone={usageTone}
      />

      <ActiveSurfacesRow activity={surfaceActivity} />

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
        <span className="text-xs text-neutral-500">
          Paste any UI string · 1 check
        </span>
      </header>
      <ExplainClient />
    </section>
  );
}

type UsageTone = "ok" | "warn" | "exhausted";

function UsagePanel({
  used,
  quota,
  usedPct,
  tone,
}: {
  used: number;
  quota: number;
  usedPct: number;
  tone: UsageTone;
}) {
  const barClasses: Record<UsageTone, string> = {
    ok: "bg-black dark:bg-white",
    warn: "bg-amber-500",
    exhausted: "bg-red-500",
  };
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Usage this month</h2>
        <span className="text-xs text-neutral-500">{currentMonth()}</span>
      </header>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-3xl font-semibold">{used.toLocaleString()}</span>
        <span className="text-sm text-neutral-500">
          of {quota.toLocaleString()} checks
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
        <div
          className={`h-full transition-[width] ${barClasses[tone]}`}
          style={{ width: `${usedPct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Resets {nextMonthReset()}.
      </p>
      {tone === "warn" && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          You&apos;ve used past 80% of your {quota.toLocaleString()} checks
          for {currentMonth()}. Upgrades take effect immediately if you need
          more headroom before {nextMonthReset()}.
        </p>
      )}
      {tone === "exhausted" && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          You&apos;ve used all {quota.toLocaleString()} checks for{" "}
          {currentMonth()}. Resets {nextMonthReset()}, or upgrade to keep
          going.
        </p>
      )}
    </section>
  );
}

type SurfaceKey = "mcp" | "lsp" | "action" | "plugin" | "cli";
type SurfaceActivity = Record<SurfaceKey, { count: number; lastAt: Date | null }>;

const SURFACES: ReadonlyArray<{
  key: SurfaceKey;
  label: string;
  installHref: string;
  installLabel: string;
}> = [
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
    label: "Figma",
    installHref: "/install#figma",
    installLabel: "Install",
  },
  { key: "cli", label: "CLI", installHref: "/install#cli", installLabel: "Install" },
];

function ActiveSurfacesRow({ activity }: { activity: SurfaceActivity }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Active surfaces</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SURFACES.map((s) => (
          <SurfaceCard
            key={s.key}
            label={s.label}
            installHref={s.installHref}
            installLabel={s.installLabel}
            count={activity[s.key].count}
            lastAt={activity[s.key].lastAt}
          />
        ))}
      </div>
    </section>
  );
}

function SurfaceCard({
  label,
  installHref,
  installLabel,
  count,
  lastAt,
}: {
  label: string;
  installHref: string;
  installLabel: string;
  count: number;
  lastAt: Date | null;
}) {
  const connected = count > 0 && lastAt !== null;
  return (
    <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <p className="font-medium">{label}</p>
      <div className="mt-2 flex items-center gap-1.5">
        <span
          aria-hidden
          className={
            connected
              ? "inline-block h-2 w-2 rounded-full bg-emerald-500"
              : "inline-block h-2 w-2 rounded-full border border-neutral-300 dark:border-neutral-700"
          }
        />
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {connected ? formatRelative(lastAt) : "Not connected"}
        </span>
      </div>
      {connected ? (
        <p className="mt-1 text-xs tabular-nums text-neutral-500">
          {count.toLocaleString()} {count === 1 ? "check" : "checks"}
        </p>
      ) : (
        <Link
          href={installHref}
          className="mt-1 inline-block text-xs text-neutral-700 underline underline-offset-2 dark:text-neutral-300"
        >
          {installLabel} →
        </Link>
      )}
    </div>
  );
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
        <span className="text-xs text-neutral-500">Last 7 days</span>
      </header>
      {!hasActivity ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
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
              breaks down which standards your team disagrees with most —
              consider tuning them in team rules.
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            {plan === "team" && (
              <Link
                href="/dashboard/overrides"
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                Open override report
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
        <span className="text-xs text-neutral-500">
          {optedOut ? "Opted out" : "Weekly · 60 sec"}
        </span>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        Three pairwise judgment prompts a week, optional. Picks feed
        the human-judgment signal behind the content model.
      </p>
      <Link
        href="/dashboard/calibrate"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {optedOut ? "Visit calibration settings" : "Open calibration prompt"}
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
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        Invite teammates by email. They&apos;ll share the monthly check
        quota, custom rules, and custom examples.
      </p>
      <Link
        href="/dashboard/members"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        Open members
      </Link>
    </section>
  );
}

function OverridesLink() {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Override report</h2>
        <span className="text-xs text-neutral-500">Last 30 days</span>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        The rules your team dismisses most. Use this to decide which
        standards to tune or disable in team rules.
      </p>
      <Link
        href="/dashboard/overrides"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        Open override report
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
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        Disable standards or add custom rules for your team. Changes
        apply to every evaluation your team runs.
      </p>
      <Link
        href="/dashboard/team/rules"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        Open team rules
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
  const db = getDb();
  const [sub] = await db
    .select({ seats: schema.subscriptions.seats })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, ownerId),
        eq(schema.subscriptions.plan, "team"),
      ),
    )
    .limit(1);
  return sub?.seats ?? 1;
}

async function loadActiveSubscription(
  userId: string,
  teamOwnerUserId: string | null,
): Promise<{
  status: string;
  currentPeriodEnd: Date | null;
} | null> {
  const ownerId = teamOwnerUserId ?? userId;
  const db = getDb();
  const [row] = await db
    .select({
      status: schema.subscriptions.status,
      currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
    })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, ownerId),
        inArray(schema.subscriptions.status, ["active", "trialing", "past_due"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadCurrentUsage(userId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: schema.usage.count })
    .from(schema.usage)
    .where(
      and(
        eq(schema.usage.userId, userId),
        eq(schema.usage.month, currentMonth()),
      ),
    )
    .limit(1);
  return row?.count ?? 0;
}

/**
 * Aggregate per-source check counts + last-call time. Scoped to the
 * team (teamId = teamOwnerUserId for members, user.id for owners).
 * Returns a complete record with zero-counts for surfaces never used —
 * the renderer can lay out all five cards regardless of activity.
 */
async function loadSurfaceActivity(
  userId: string,
  teamOwnerUserId: string | null,
): Promise<SurfaceActivity> {
  const teamId = teamOwnerUserId ?? userId;
  const db = getDb();
  const rows = (await db
    .select({
      source: schema.violations.source,
      count: sql<number>`count(*)::int`,
      lastAt: sql<Date>`max(${schema.violations.createdAt})`,
    })
    .from(schema.violations)
    .where(eq(schema.violations.teamId, teamId))
    .groupBy(schema.violations.source)
    .orderBy(desc(sql`max(${schema.violations.createdAt})`))) as Array<{
    source: string;
    count: number;
    lastAt: Date;
  }>;

  const out: SurfaceActivity = {
    mcp: { count: 0, lastAt: null },
    lsp: { count: 0, lastAt: null },
    action: { count: 0, lastAt: null },
    plugin: { count: 0, lastAt: null },
    cli: { count: 0, lastAt: null },
  };
  for (const r of rows) {
    if (r.source in out) {
      out[r.source as SurfaceKey] = {
        count: r.count,
        lastAt: r.lastAt instanceof Date ? r.lastAt : new Date(r.lastAt),
      };
    }
  }
  return out;
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
  const since = new Date(Date.now() - INSIGHTS_WINDOW_MS);
  const db = getDb();

  const [violationsCount, overridesCount, topSource, patternAggregates] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.violations)
        .where(
          and(
            eq(schema.violations.teamId, teamId),
            gte(schema.violations.createdAt, since),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.violationOverrides)
        .where(
          and(
            eq(schema.violationOverrides.teamId, teamId),
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
            eq(schema.violations.teamId, teamId),
            gte(schema.violations.createdAt, since),
          ),
        )
        .groupBy(schema.violations.source)
        .orderBy(desc(sql`count(*)`))
        .limit(1),
      loadFindingAggregates(teamId, since),
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

const TRACKED_SURFACES = new Set([
  "mcp",
  "lsp",
  "action",
  "plugin",
  "cli",
]);

/**
 * Pick the most recently activated surface for the FirstCallBanner
 * (PR-32). Definition of "recently activated": this team's earliest
 * violation from a given source landed within the last 7 days. If
 * multiple surfaces newly activated in that window, return the most
 * recent one — that's the one the user is currently celebrating.
 */
async function loadRecentlyActivatedSurface(
  userId: string,
  teamOwnerUserId: string | null,
): Promise<SurfaceKey | null> {
  const teamId = teamOwnerUserId ?? userId;
  const since = new Date(Date.now() - ACTIVATION_WINDOW_MS);
  const db = getDb();
  const rows = (await db
    .select({
      source: schema.violations.source,
      firstAt: sql<Date>`min(${schema.violations.createdAt})`,
    })
    .from(schema.violations)
    .where(eq(schema.violations.teamId, teamId))
    .groupBy(schema.violations.source)) as Array<{
    source: string;
    firstAt: Date;
  }>;

  let best: { source: SurfaceKey; firstAt: Date } | null = null;
  for (const r of rows) {
    if (!TRACKED_SURFACES.has(r.source)) continue;
    const firstAt = r.firstAt instanceof Date ? r.firstAt : new Date(r.firstAt);
    if (firstAt < since) continue;
    if (!best || firstAt > best.firstAt) {
      best = { source: r.source as SurfaceKey, firstAt };
    }
  }
  return best?.source ?? null;
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
