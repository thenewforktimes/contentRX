/**
 * /dashboard/settings/overage — opt-in to $0.10/check overage.
 *
 * Phase 4 of the post-Phase-1 build. Customers on paid plans (Pro,
 * Team, Scale) flip the switch here to authorize overage past their
 * monthly cap. The toggle posts to /api/billing/overage-opt-in.
 *
 * Free users get redirected to the upgrade flow — Free can't opt in
 * to overage by design (no Stripe subscription to bill against).
 *
 * BETA_OVERAGE gate: while the env var is unset / not "true", the
 * page returns 404 (notFound posture). The toggle's API counterpart
 * uses the same gate, so a customer with a stale link can't bypass.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import { OVERAGE_RATE_CENTS } from "@/lib/usage";
import { currentMonth, monthlyQuota, type Plan } from "@/lib/quotas";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { OverageToggle } from "./overage-toggle";

export const metadata = {
  title: "Overage. ContentRX",
  robots: { index: false, follow: false },
};

function isBetaOverageEnabled(): boolean {
  return process.env.BETA_OVERAGE === "true";
}

export default async function OveragePage() {
  if (!isBetaOverageEnabled()) {
    notFound();
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/settings/overage");
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
  if (plan === "free") {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <Eyebrow>Settings</Eyebrow>
          <h1 className="mt-2 text-2xl font-semibold">Overage</h1>
        </header>
        <section className="rounded-lg border border-line p-5">
          <p className="text-sm text-default">
            Overage is available on paid plans only. Free hard-caps at
            10 checks a month with no charges. To run more checks per
            month, upgrade to Pro.
          </p>
          <Link
            href="/pricing"
            className="mt-3 inline-flex items-center rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-overlay"
          >
            See plans
          </Link>
        </section>
      </div>
    );
  }

  const seats = await loadSeatsForOwner(user.id, plan, user.teamOwnerUserId);
  const quota = monthlyQuota(plan, seats);
  const overage = await loadCurrentMonthOverage(user.id);
  const projectedCents = overage.checks * OVERAGE_RATE_CENTS;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow>Settings</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold">Overage</h1>
      </header>

      <section className="rounded-lg border border-line p-5">
        <h2 className="text-base font-semibold text-strong">Opt in to overage</h2>
        <p className="mt-2 text-sm text-default">
          When enabled, checks past your monthly limit of {quota.toLocaleString()}{" "}
          bill at $0.10 per check. We charge it on your next Stripe
          invoice. You can disable any time.
        </p>
        <div className="mt-4">
          <OverageToggle
            initialActive={user.overageOptInActive}
            initialOptedInAt={
              user.overageOptedInAt
                ? user.overageOptedInAt.toISOString()
                : null
            }
          />
        </div>
      </section>

      <section className="rounded-lg border border-line p-5">
        <h2 className="text-base font-semibold text-strong">This month</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-quiet">Overage checks</dt>
            <dd className="mt-1 text-lg font-medium tabular-nums">
              {overage.checks.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-quiet">Projected charge</dt>
            <dd className="mt-1 text-lg font-medium tabular-nums">
              ${(projectedCents / 100).toFixed(2)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-quiet">Billing month</dt>
            <dd className="mt-1 text-lg font-medium tabular-nums">
              {currentMonth()}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-quiet">
          Overage usage is metered locally and posted to Stripe at the
          end of each billing month. The next invoice carries the
          line item.
        </p>
      </section>
    </div>
  );
}

async function loadSeatsForOwner(
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

async function loadCurrentMonthOverage(
  userId: string,
): Promise<{ checks: number; cents: number }> {
  const db = getDb();
  const [row] = await db
    .select({
      checks: schema.overageState.overageChecks,
      cents: schema.overageState.overageUsdCents,
    })
    .from(schema.overageState)
    .where(
      and(
        eq(schema.overageState.userId, userId),
        eq(schema.overageState.month, currentMonth()),
      ),
    )
    .limit(1);
  return { checks: row?.checks ?? 0, cents: row?.cents ?? 0 };
}
