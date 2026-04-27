/**
 * Domain-based team grouping (PR-21/22/23).
 *
 * The pricing-and-unit-of-value strategy doc deferred a real Team
 * tier "until the buying motion clarifies." Until then, team behavior
 * is delivered via this module: when 3+ active Pro/Scale subscriptions
 * share an email domain, they're auto-grouped — single billing
 * lineage in our DB (domainGroupId) + bumped to plan="team" so the
 * existing dashboard team-tier UI activates without a Team-purchase
 * decision. Per Position-3 (locked Apr 2026), there is no admin role
 * to promote to: the first-domain user is the team_owner_user_id
 * reference (so their id is the team-scope key in queries) but has
 * no special UI capabilities.
 *
 * Free email providers (gmail, outlook, yahoo, etc.) are excluded
 * from auto-grouping — those are individuals sharing a host, not
 * teammates. A small DENY list is checked; anything not on it is
 * treated as a corporate domain.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@/db";
import { getStripe } from "@/lib/stripe";

const GROUP_THRESHOLD = 3;
const GROUPED_PRICING_TIERS = ["pro", "scale", "team"] as const;

/**
 * Free-email-provider DENY list. Domains here are NEVER auto-grouped
 * because their users are individuals who happen to share a host, not
 * teammates from the same company. List intentionally narrow — when in
 * doubt, treat as corporate (the failure mode of a false positive — two
 * solo gmail users + one corporate user wrongly grouped — is ugly;
 * the failure mode of a false negative — a corporate user from a less-
 * common provider not auto-grouped — is "they don't get the discount,"
 * which they can ask for).
 */
const FREE_EMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "aol.com",
  "mail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "yandex.com",
  "yandex.ru",
  "fastmail.com",
  "fastmail.fm",
  "duck.com",
  "tutanota.com",
  "tuta.io",
  "zoho.com",
  "pm.me",
]);

/** Lowercase + trim. The part after the last `@`. Empty string when malformed. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

export function isCorporateDomain(domain: string): boolean {
  if (!domain) return false;
  return !FREE_EMAIL_DOMAINS.has(domain);
}

/**
 * Returns the active Pro/Scale users with the given domain, ordered by
 * earliest createdAt first (the "owner" is the head of the list).
 */
async function listActivePaidUsersInDomain(
  domain: string,
): Promise<Array<{ id: string; email: string; createdAt: Date; plan: string }>> {
  if (!domain) return [];
  const db = getDb();
  // Match users.email by case-insensitive suffix. Drizzle's `ilike` would
  // be cleaner; using lower() keeps us provider-agnostic.
  const rows = (await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      createdAt: schema.users.createdAt,
      plan: schema.users.plan,
    })
    .from(schema.users)
    .where(
      and(
        sql`lower(${schema.users.email}) like ${"%@" + domain}`,
        inArray(schema.users.plan, ["pro", "scale", "team"]),
      ),
    )
    .orderBy(asc(schema.users.createdAt))) as Array<{
    id: string;
    email: string;
    createdAt: Date;
    plan: string;
  }>;
  return rows;
}

/**
 * Run after a Pro/Scale subscription activates. If 3+ users from the
 * same corporate domain are now on Pro/Scale, link them via
 * domainGroupId, set team_owner_user_id on the non-owners, bump plan
 * to "team" so the existing team UI activates, and (when the
 * `CONTENTRX_DOMAIN_GROUP_COUPON_ID` env is set) apply a 10% discount
 * to every grouped subscription.
 *
 * Idempotent: re-running on an already-grouped domain is a no-op
 * (existing domainGroupId is reused; users with team_owner_user_id
 * already set are left alone).
 *
 * Returns the resulting domainGroupId when grouping happened, or null
 * if the threshold wasn't met / the domain was a free-email provider.
 */
export async function maybeGroupByDomain(
  userId: string,
): Promise<string | null> {
  const db = getDb();
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      teamOwnerUserId: schema.users.teamOwnerUserId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return null;

  const domain = emailDomain(user.email);
  if (!isCorporateDomain(domain)) return null;

  const sameDomain = await listActivePaidUsersInDomain(domain);
  if (sameDomain.length < GROUP_THRESHOLD) return null;

  // The first existing grouped row in this domain (if any) tells us
  // whether the group already exists. Reuse its id; otherwise create a
  // fresh one. Owner is always the earliest user (sameDomain[0]).
  const owner = sameDomain[0];
  const groupedRows = await db
    .select({
      id: schema.users.id,
      domainGroupId: schema.subscriptions.domainGroupId,
    })
    .from(schema.subscriptions)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.subscriptions.userId),
    )
    .where(
      and(
        inArray(
          schema.users.id,
          sameDomain.map((u) => u.id),
        ),
        sql`${schema.subscriptions.domainGroupId} IS NOT NULL`,
      ),
    )
    .limit(1);
  const existingGroupId = (groupedRows[0]?.domainGroupId as string | null) ?? null;
  const groupId = existingGroupId ?? `dg_${createId()}`;

  // Apply linkage to every member of the cohort. Each operation is
  // independently idempotent — same data → same write.
  for (const member of sameDomain) {
    await db
      .update(schema.subscriptions)
      .set({ domainGroupId: groupId })
      .where(
        and(
          eq(schema.subscriptions.userId, member.id),
          inArray(
            schema.subscriptions.pricingTier,
            GROUPED_PRICING_TIERS as unknown as string[],
          ),
        ),
      );

    const isOwner = member.id === owner.id;
    await db
      .update(schema.users)
      .set({
        teamOwnerUserId: isOwner ? null : owner.id,
        plan: "team",
      })
      .where(eq(schema.users.id, member.id));
  }

  // Best-effort: apply the 10% domain-grouping coupon to each member's
  // subscription. Skip the entire step when the env var isn't set
  // (Robo creates the coupon in Stripe Dashboard before flipping it on).
  await applyDomainCoupon(sameDomain.map((u) => u.id)).catch((err) => {
    console.warn("domain coupon application failed (non-fatal)", err);
  });

  return groupId;
}

async function applyDomainCoupon(userIds: string[]): Promise<void> {
  const couponId = process.env.CONTENTRX_DOMAIN_GROUP_COUPON_ID;
  if (!couponId) return; // Dashboard coupon not yet configured — skip.

  const db = getDb();
  const subs = (await db
    .select({
      stripeSubId: schema.subscriptions.stripeSubId,
      userId: schema.subscriptions.userId,
    })
    .from(schema.subscriptions)
    .where(
      and(
        inArray(schema.subscriptions.userId, userIds),
        eq(schema.subscriptions.status, "active"),
      ),
    )) as Array<{ stripeSubId: string; userId: string }>;

  if (subs.length === 0) return;

  const stripe = getStripe();
  for (const sub of subs) {
    try {
      // Stripe API treats `coupon` as deprecated; the modern equivalent
      // is `discounts` array. Either is accepted; using `discounts` for
      // forward-compat with the 2026-* API versions.
      await stripe.subscriptions.update(sub.stripeSubId, {
        discounts: [{ coupon: couponId }],
      });
    } catch (err) {
      console.warn(
        `failed to apply domain coupon to ${sub.stripeSubId}`,
        err,
      );
    }
  }
}
