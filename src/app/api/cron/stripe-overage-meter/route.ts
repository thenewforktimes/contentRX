/**
 * GET/POST /api/cron/stripe-overage-meter — end-of-month overage push.
 *
 * Phase 4 of the post-Phase-1 build. Reads `overage_state` rows for
 * the closing billing month and posts one Stripe Meter Event per
 * user-month so the next invoice carries the metered line item.
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
 * Stripe API: stripe.billing.meterEvents.create() (the SDK 22+ way;
 * the older subscriptionItems.createUsageRecord was removed in this
 * SDK version). Each event carries a stable `identifier` keyed off
 * (userId, closingMonth) so Stripe-side dedup catches re-runs within
 * its rolling identifier-uniqueness window. Redis dedup (TTL 35 days)
 * is the second-line guarantee for a re-run that lands outside that
 * window.
 *
 * The Stripe Meter must be configured in the Dashboard with
 * `event_name = STRIPE_OVERAGE_METER_EVENT_NAME` (defaults to
 * "contentrx_overage_check") and `value_settings.event_payload_key
 * = "value"`. Customer mapping defaults to "stripe_customer_id".
 *
 * BETA_OVERAGE gate: while the env var is unset / not "true", the
 * cron returns ok+skipped without touching Stripe. The data still
 * accumulates in overage_state; whenever beta opens, the next monthly
 * cron picks it up (subject to the meter-event 35-day backdate window).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OverageMeterFailureAlertEmail } from "@/emails/overage-meter-failure-alert";
import { getDb, schema } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { appUrl, sendEmail } from "@/lib/email";
import { getRedis } from "@/lib/redis";
import { getStripe } from "@/lib/stripe";
import { logSafeError } from "@/lib/safe-error-log";
import { optionalEnv } from "@/lib/require-env";

const DEDUPE_TTL_SECONDS = 35 * 24 * 60 * 60;
const DEFAULT_METER_EVENT_NAME = "contentrx_overage_check";

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
    | "skipped_no_customer"
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
  /** True when the founder alert email was dispatched for this run.
   * Absent (rather than false) when there were no failures, so the
   * happy-path response shape is unchanged. */
  alertEmailSent?: boolean;
  alertEmailDeduplicated?: boolean;
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
  const eventName =
    optionalEnv("STRIPE_OVERAGE_METER_EVENT_NAME") ?? DEFAULT_METER_EVENT_NAME;

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
  // user's customer record so we have stripeCustomerId in one query.
  const rows = (await db
    .select({
      userId: schema.overageState.userId,
      overageChecks: schema.overageState.overageChecks,
      stripeCustomerId: schema.users.stripeCustomerId,
    })
    .from(schema.overageState)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.overageState.userId),
    )
    .where(eq(schema.overageState.month, closingMonth))) as Array<{
      userId: string;
      overageChecks: number;
      stripeCustomerId: string | null;
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

    if (!row.stripeCustomerId) {
      r.status = "skipped_no_customer";
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
      // The Stripe identifier below provides second-line dedup.
      logSafeError("stripe-overage-meter dedupe lookup failed", err);
    }

    try {
      await stripe.billing.meterEvents.create({
        event_name: eventName,
        payload: {
          stripe_customer_id: row.stripeCustomerId,
          value: row.overageChecks.toString(),
        },
        // Stable per (userId, closingMonth) so a re-run within the
        // identifier-uniqueness rolling window is a no-op on Stripe's
        // side. After that window expires Redis still blocks (35d TTL).
        identifier: `overage:${row.userId}:${closingMonth}`,
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

  // Founder alert: any push failure means a user-month didn't reach
  // Stripe, so they'll be under-billed unless we re-attempt before the
  // period closes. Fire once per closing-month-day via Redis dedupe so
  // a manual re-run of the cron same-day doesn't double-email.
  let alertEmailSent: boolean | undefined;
  let alertEmailDeduplicated: boolean | undefined;
  if (errored > 0) {
    const failures = results
      .filter((r): r is UserPushResult & { error: string } =>
        r.status === "error" && typeof r.error === "string",
      )
      .map((r) => ({
        userId: r.userId,
        overageChecks: r.overageChecks,
        error: r.error,
      }));
    const founderEmail = process.env.FOUNDER_EMAIL ?? "hello@contentrx.io";
    const today = new Date().toISOString().slice(0, 10);
    try {
      const result = await sendEmail({
        to: founderEmail,
        subject: `Overage meter: ${errored} push failure${errored === 1 ? "" : "s"} for ${closingMonth}`,
        react: OverageMeterFailureAlertEmail({
          closingMonth,
          errored,
          pushed,
          failures,
          appUrl: appUrl(),
        }),
        // (closingMonth, today) so a same-day re-run doesn't double
        // email but a re-run on a later day (after partial recovery)
        // can re-alert if failures persist.
        dedupeKey: `overage-meter-failure-alert:${closingMonth}:${today}`,
      });
      alertEmailSent = result.ok && !result.deduplicated;
      alertEmailDeduplicated = !!result.deduplicated;
    } catch (err) {
      logSafeError("overage-meter founder alert email failed", err);
      alertEmailSent = false;
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
    ...(alertEmailSent !== undefined ? { alertEmailSent } : {}),
    ...(alertEmailDeduplicated ? { alertEmailDeduplicated: true } : {}),
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
