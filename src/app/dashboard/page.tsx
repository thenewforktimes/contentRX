/**
 * /dashboard — account overview. Server-rendered so we can hit the DB
 * inline without a round-trip to a separate API endpoint.
 *
 * Shows: plan pill, month-to-date usage bar, API key management (via a
 * client subcomponent). The api_key_hash is never sent to the browser —
 * only the display prefix and the creation timestamp cross the wire.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { currentMonth, monthlyQuota, type Plan } from "@/lib/quotas";
import { ApiKeyPanel } from "./api-key-panel";
import { SubscriptionPanel } from "./subscription-panel";

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

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    // Clerk session exists but the webhook hasn't created the row yet.
    // Bounce through a quick "getting your account ready" view.
    return (
      <section className="rounded-lg border border-neutral-200 p-6 text-sm dark:border-neutral-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const plan = user.plan as Plan;
  const seats = await loadSeats(user.id, plan, user.teamOwnerUserId);
  const quota = monthlyQuota(plan, seats);
  const used = await loadCurrentUsage(user.id);
  const usedPct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const activeSub = await loadActiveSubscription(user.id, user.teamOwnerUserId);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
            Dashboard
          </p>
          <h1 className="mt-2 text-2xl font-semibold">{user.email}</h1>
        </div>
        <PlanPill plan={plan} />
      </header>

      <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Usage this month</h2>
          <span className="text-xs text-neutral-500">{currentMonth()}</span>
        </header>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-3xl font-semibold">{used.toLocaleString()}</span>
          <span className="text-sm text-neutral-500">
            of {quota.toLocaleString()} scans
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
          <div
            className={`h-full transition-[width] ${
              used >= quota ? "bg-red-500" : "bg-black dark:bg-white"
            }`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Resets {nextMonthReset()}.
        </p>
        {used >= quota && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            You&apos;ve hit this month&apos;s quota. Upgrade or wait for the
            reset.
          </p>
        )}
      </section>

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

      <ApiKeyPanel
        initialPrefix={user.apiKeyPrefix}
        initialCreatedAt={
          user.apiKeyCreatedAt ? user.apiKeyCreatedAt.toISOString() : null
        }
      />

      {plan === "team" && (
        <>
          <TeamRulesLink isAdmin={user.teamOwnerUserId === null} />
          <TeamAnalyticsLink />
        </>
      )}
    </div>
  );
}

function TeamRulesLink({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Team rules</h2>
        <span className="text-xs text-neutral-500">
          {isAdmin ? "Admin" : "Read-only"}
        </span>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        {isAdmin
          ? "Disable standards or add your team's custom rules. Changes apply to every evaluation your team runs."
          : "See which standards your team owner has disabled or added. Only the owner can make changes."}
      </p>
      <Link
        href="/dashboard/team/rules"
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Open team rules
      </Link>
    </section>
  );
}

function TeamAnalyticsLink() {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Team analytics</h2>
        <span className="text-xs text-neutral-500">Last 7 / 30 / 90 days</span>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        Violations by standard, daily trends, and per-member activity.
        No text content stored — aggregated from the violations log.
      </p>
      <Link
        href="/dashboard/team/analytics"
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Open analytics
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
  const styles: Record<Plan, string> = {
    free: "bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
    pro: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    team: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
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
