/**
 * GET/POST /api/cron/stripe-overage-meter — end-of-month overage push.
 *
 * Phase 4 of the post-Phase-1 build. Reads `overage_state` rows for
 * the closing billing month, looks up each user's metered Stripe
 * subscription item (the one keyed off STRIPE_PRICE_OVERAGE), and
 * posts a usage record so the next invoice carries the metered line
 * item.
 *
 * Cron wiring (add when enabling):
 *   // vercel.json
 *   "crons": [
 *     { "path": "/api/cron/stripe-overage-meter", "schedule": "5 0 1 * *" }
 *   ]
 * 00:05 UTC on the 1st of each month — closes the prior month. The
 * five-minute offset gives Stripe-side period rollovers a moment to
 * settle before we read.
 *
 * Idempotency: Stripe usage records use `action: "set"` (not
 * "increment"), so a re-run of the cron with the same period_end
 * timestamp is naturally idempotent — Stripe overwrites the prior
 * total with the same number. We additionally guard with a Redis
 * dedupe key per (userId, billingMonth) so a same-day re-run won't
 * round-trip Stripe at all on the second pass.
 *
 * BETA_OVERAGE gate: while the env var is unset / not "true", the
 * cron returns ok+skipped without touching Stripe. The data still
 * accumulates in overage_state; whenever beta opens, the next monthly
 * cron picks it up.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { getRedis } from "@/lib/redis";
import { getStripe } from "@/lib/stripe";
import { logSafeError } from "@/lib/safe-error-log";
import { optionalEnv } from "@/lib/require-env";

const DEDUPE_TTL_SECONDS = 35 * 24 * 60 * 60;

function isBetaOverageEnabled(): boolean {
  return process.env.BETA_OVERAGE === "true";
}

interface UserPushResult {
  userId: string;
  month: string;
  overageChecks: number;
  status:
    | "skipped_zero"
    | "skipped_dedupe"
    | "skipped_no_subscription_item"
    | "pushed"
    | "error";
  error?: string;
}

interface RunResult {
  ok: true;
  closingMonth: string;
  userCount: number;
  pushed: number;
  skipped: number;
  errored: number;
  betaEnabled: boolean;
  results?: UserPushResult[];
}

/** Format a Date as "YYYY-MM" matching `currentMonth()`. */
function monthOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Compute the prior-month string. Defaults to one month before now
 * (UTC-anchored). Pass `?month=YYYY-MM` on the GET to override during
 * testing. */
function closingMonthFromNow(): string {
  const now = new Date();
  const prior = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  return monthOf(prior);
}

async function run(opts: { month?: string }): Promise<RunResult> {
  const closingMonth = opts.month ?? closingMonthFromNow();
  const beta = isBetaOverageEnabled();
  const overagePriceId = optionalEnv("STRIPE_PRICE_OVERAGE");

  if (!beta) {
    return {
      ok: true,
      closingMonth,
      userCount: 0,
      pushed: 0,
      skipped: 0,
      errored: 0,
      betaEnabled: false,
    };
  }

  const db = getDb();

  // Pull every overage_state row for the closing month, joined to the
  // user's subscription so we have stripeSubId in one query.
  const rows = (await db
    .select({
      userId: schema.overageState.userId,
      overageChecks: schema.overageState.overageChecks,
      stripeSubId: schema.subscriptions.stripeSubId,
    })
    .from(schema.overageState)
    .leftJoin(
      schema.subscriptions,
      and(
        eq(schema.subscriptions.userId, schema.overageState.userId),
        eq(schema.subscriptions.status, "active"),
      ),
    )
    .where(eq(schema.overageState.month, closingMonth))) as Array<{
      userId: string;
      overageChecks: number;
      stripeSubId: string | null;
    }>;

  const stripe = getStripe();
  const redis = getRedis();
  const periodEnd = Math.floor(
    Date.UTC(
      Number(closingMonth.slice(0, 4)),
      Number(closingMonth.slice(5, 7)),
      0,
      23,
      59,
      59,
    ) / 1000,
  );

  const results: UserPushResult[] = [];
  let pushed = 0;
  let skipped = 0;
  let errored = 0;

  for (const row of rows) {
    const r: UserPushResult = {
      userId: row.userId,
      month: closingMonth,
      overageChecks: row.overageChecks,
      status: "pushed",
    };

    if (row.overageChecks <= 0) {
      r.status = "skipped_zero";
      results.push(r);
      skipped++;
      continue;
    }

    const dedupeKey = `stripe-overage-meter:${row.userId}:${closingMonth}`;
    try {
      const setResult = await redis.set(dedupeKey, "1", {
        nx: true,
        ex: DEDUPE_TTL_SECONDS,
      });
      if (setResult === null) {
        r.status = "skipped_dedupe";
        results.push(r);
        skipped++;
        continue;
      }
    } catch (err) {
      // Redis hiccup shouldn't block the push; logged + proceed.
      logSafeError("stripe-overage-meter dedupe lookup failed", err);
    }

    if (!row.stripeSubId) {
      r.status = "skipped_no_subscription_item";
      results.push(r);
      skipped++;
      continue;
    }

    try {
      // Find the metered subscription item by matching its price ID
      // against STRIPE_PRICE_OVERAGE. Pre-Phase-1 setup creates the
      // metered item alongside the flat-fee item on every paid sub;
      // a sub without it means the customer was provisioned before
      // the overage SKU existed and needs a manual backfill.
      const sub = await stripe.subscriptions.retrieve(row.stripeSubId, {
        expand: ["items.data"],
      });
      const meteredItem = sub.items.data.find(
        (it) => overagePriceId && it.price.id === overagePriceId,
      );
      if (!meteredItem) {
        r.status = "skipped_no_subscription_item";
        results.push(r);
        skipped++;
        continue;
      }

      await stripe.subscriptionItems.createUsageRecord(meteredItem.id, {
        quantity: row.overageChecks,
        action: "set",
        timestamp: periodEnd,
      });
      results.push(r);
      pushed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      r.status = "error";
      r.error = message;
      results.push(r);
      errored++;
      logSafeError("stripe-overage-meter push failed", err);
    }
  }

  return {
    ok: true,
    closingMonth,
    userCount: rows.length,
    pushed,
    skipped,
    errored,
    betaEnabled: true,
    results,
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;
  const url = new URL(req.url);
  const monthOverride = url.searchParams.get("month") ?? undefined;
  return NextResponse.json(await run({ month: monthOverride }));
}

export async function GET(req: Request): Promise<NextResponse> {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;
  const url = new URL(req.url);
  const monthOverride = url.searchParams.get("month") ?? undefined;
  return NextResponse.json(await run({ month: monthOverride }));
}
