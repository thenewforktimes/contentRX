/**
 * /dashboard — account overview. Server-rendered so we can hit the DB
 * inline without a round-trip to a separate API endpoint.
 *
 * Section order (Apr 2026 inversion): API key first because it's the
 * asset the customer is here to manage; usage bar second as the live
 * signal; subscription third (billing); team-tier surfaces fourth;
 * calibration last. Pre-inversion the order put billing/usage above
 * the API key, which buried the integration step new customers came
 * for.
 *
 * Usage bar tones: amber at ≥80% so the customer has runway to
 * upgrade before they hit zero.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import { currentMonth, monthlyQuota, type Plan } from "@/lib/quotas";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { ApiKeyPanel } from "./api-key-panel";
import { SubscriptionPanel } from "./subscription-panel";

const USAGE_WARNING_THRESHOLD = 0.8;

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

  // Lazy-provision the users row if the Clerk webhook hasn't landed
  // yet (or got dropped). Mirrors /auth/figma-callback's behavior so a
  // first-load dashboard hit isn't gated on webhook delivery. On the
  // rare provisioning failure (Clerk API hiccup, transient DB error)
  // fall back to the placeholder UI rather than crashing into the
  // global error boundary.
  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-neutral-200 p-6 text-sm dark:border-neutral-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const plan = user.plan as Plan;
  // Closes audit H-17: was 4 sequential awaits. seats / used /
  // activeSub are all independent of each other (each only needs
  // user.id and the already-resolved plan), so fan them out in
  // parallel. monthlyQuota stays synchronous after seats resolves.
  const [seats, used, activeSub] = await Promise.all([
    loadSeats(user.id, plan, user.teamOwnerUserId),
    loadCurrentUsage(user.id),
    loadActiveSubscription(user.id, user.teamOwnerUserId),
  ]);
  const quota = monthlyQuota(plan, seats);
  const usedPct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const usageTone: UsageTone =
    used >= quota ? "exhausted" : used >= quota * USAGE_WARNING_THRESHOLD ? "warn" : "ok";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <Eyebrow>Dashboard</Eyebrow>
          <h1 className="mt-2 text-2xl font-semibold">{user.email}</h1>
        </div>
        <PlanPill plan={plan} />
      </header>

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
          You&apos;re past 80% of this month&apos;s quota. Plan upgrades take
          effect immediately if you need more headroom.
        </p>
      )}
      {tone === "exhausted" && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          You&apos;ve hit this month&apos;s quota. Upgrade or wait for the
          reset.
        </p>
      )}
    </section>
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
  // For team members, the billing status lives on the team owner's row.
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

function PlanPill({ plan }: { plan: Plan }) {
  // Semantically progressive: neutral (free) → blue (pro, paid) →
  // emerald (team, paid + collaborative). The pre-inversion purple
  // for team felt arbitrary; emerald reads as "shared / collaborative"
  // (per the design critique).
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
