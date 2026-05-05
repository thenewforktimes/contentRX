/**
 * /dashboard/settings — account management.
 *
 * Surfaced via the new top-nav link in the dashboard layout. Mirrors
 * the configuration sections that previously lived only on /dashboard
 * itself (API key, subscription) plus adds account + privacy controls
 * that hadn't had a home before.
 *
 * Section order:
 *   1. Account (email + Clerk profile link for password / 2FA / etc.)
 *   2. Subscription (current plan, manage in Stripe)
 *   3. API key (mint / rotate / revoke — same panel as /dashboard)
 *   4. Privacy (export your data via email; delete account in-product
 *      via the typed-confirm flow at DeleteAccountSection — wires
 *      through /api/dashboard/delete-account)
 *
 * Auth + provisioning mirrors /dashboard. If the user record isn't
 * provisioned yet (mid-Clerk-webhook), render the same "finishing up"
 * placeholder.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { tags } from "@/lib/cache-tags";
import { asDate } from "@/lib/date-rehydrate";
import { getDb, schema } from "@/db";
import { type Plan } from "@/lib/quotas";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { ApiKeyPanel } from "../api-key-panel";
import { SubscriptionPanel } from "../subscription-panel";
import { DeleteAccountSection } from "./delete-account-section";

export const metadata = {
  title: "Settings. ContentRX",
};

export default async function SettingsPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/settings");
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
  const [seats, activeSub] = await Promise.all([
    loadSeats(user.id, plan, user.teamOwnerUserId),
    loadActiveSubscription(user.id, user.teamOwnerUserId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <Eyebrow>Settings</Eyebrow>
          <h1 className="mt-2 text-2xl font-semibold">Account</h1>
        </div>
        <Pill tone={plan === "free" ? "neutral" : "emerald"}>
          {plan.charAt(0).toUpperCase() + plan.slice(1)}
        </Pill>
      </header>

      <AccountPanel email={user.email} />

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

      <PrivacyPanel email={user.email} />
    </div>
  );
}

function AccountPanel({ email }: { email: string }) {
  return (
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Account</h2>
        <span className="text-xs text-quiet">
          Managed by Clerk
        </span>
      </header>
      <p className="mb-3 text-sm text-default">
        Signed in as <span className="font-medium">{email}</span>. Update
        your email, password, or two-factor authentication in your
        account profile.
      </p>
      <Link
        href="/sign-in/account"
        className="inline-flex items-center rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-hover"
      >
        Manage account
      </Link>
    </section>
  );
}

function PrivacyPanel({ email }: { email: string }) {
  const exportSubject = encodeURIComponent("[EXPORT] " + email);
  return (
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Privacy</h2>
        <span className="text-xs text-quiet">
          See <Link href="/privacy" className="underline underline-offset-2">/privacy</Link>
        </span>
      </header>
      <p className="mb-3 text-sm text-default">
        See what we have on you, or delete your account. Both rights
        are baked into the product.
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={`mailto:privacy@contentrx.io?subject=${exportSubject}`}
          className="inline-flex items-center rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-overlay"
        >
          Export my data
        </a>
      </div>
      <DeleteAccountSection />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Data loaders — mirror /dashboard so SubscriptionPanel renders correctly.
// Same caching strategy + same tag invalidation path.
// ---------------------------------------------------------------------------

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
  return {
    status: cached.status,
    currentPeriodEnd: asDate(cached.currentPeriodEnd),
  };
}
