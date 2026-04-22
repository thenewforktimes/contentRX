/**
 * /dashboard — account overview. Server-rendered so we can hit the DB
 * inline without a round-trip to a separate API endpoint.
 *
 * Shows: plan pill, month-to-date usage bar, API key management (via a
 * client subcomponent). The api_key_hash is never sent to the browser —
 * only the display prefix and the creation timestamp cross the wire.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { currentMonth, monthlyQuota, type Plan } from "@/lib/quotas";
import { ApiKeyPanel } from "./api-key-panel";

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

      <SubscriptionPanel plan={plan} />

      <ApiKeyPanel
        initialPrefix={user.apiKeyPrefix}
        initialCreatedAt={
          user.apiKeyCreatedAt ? user.apiKeyCreatedAt.toISOString() : null
        }
      />

      <DittoPanel />
    </div>
  );
}

function SubscriptionPanel({ plan }: { plan: Plan }) {
  const label = plan === "free" ? "Upgrade plan" : "Manage subscription";
  const copy =
    plan === "free"
      ? "You're on the Free plan (25 scans / month). Upgrade to Pro for 5,000 scans."
      : "Billing is handled by Stripe. The Customer Portal lets you change plans, update payment methods, or cancel.";
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Subscription</h2>
        <span className="text-xs text-neutral-500">
          Billing wiring arrives in the Stripe session
        </span>
      </header>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        {copy}
      </p>
      <button
        type="button"
        disabled
        className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white opacity-50 dark:bg-white dark:text-black"
        title="Available after the Stripe integration lands"
      >
        {label}
      </button>
    </section>
  );
}

function DittoPanel() {
  return (
    <section className="rounded-lg border border-dashed border-neutral-300 p-5 text-sm text-neutral-500 dark:border-neutral-700">
      <header className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-neutral-700 dark:text-neutral-300">
          Connect Ditto
        </h2>
        <span className="text-xs">Coming soon</span>
      </header>
      <p>
        Scan Ditto components for content-standard violations alongside your
        Figma work. Lands once the Ditto integration session ships.
      </p>
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
