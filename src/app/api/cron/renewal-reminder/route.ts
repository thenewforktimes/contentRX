/**
 * POST /api/cron/renewal-reminder — daily pre-renewal reminder cron.
 *
 * California Automatic Renewal Law (CARL / AB 2863, 2025-07-01)
 * requires customers on subscriptions of 1+ year to receive at
 * least one annual reminder before renewal. We send 15 days out
 * for every cycle (monthly + annual) — overshoots CARL for monthly
 * cycles but keeps cadence simple and avoids surprise charges.
 *
 * Query window: subscriptions with `current_period_end` in the
 * 24-hour band starting 15 days from now. Dedupe key includes the
 * period-end YYYY-MM-DD so a renewal that gets shifted (Stripe
 * adjustment, manual sub edit) doesn't re-send for the same renewal
 * date.
 *
 * Cron wiring lives in vercel.json:
 *   { "path": "/api/cron/renewal-reminder", "schedule": "0 10 * * *" }
 * Daily at 10:00 UTC.
 *
 * Auth: Vercel Cron passes `Authorization: Bearer <CRON_SECRET>`.
 * Missing / wrong secret → 401 / 503. Mirrors rollback-monitor.
 */

import { NextResponse } from "next/server";
import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { appUrl, sendEmail } from "@/lib/email";
import { RenewalReminderEmail } from "@/emails/renewal-reminder";
import { logSafeError } from "@/lib/safe-error-log";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS_AHEAD = 15;

// Pricing labels for the reminder body. These mirror the SKUs on
// /pricing — keep in sync when prices change. The cron renders the
// pre-formatted string; the email template doesn't compute prices.
const PRICE_LABEL: Record<string, string> = {
  pro: "$39.00 / month",
  team: "$79.00 / seat / month",
  scale: "$1,799.00 / month",
};

export async function POST(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const db = getDb();
  const now = Date.now();
  const windowStart = new Date(now + REMINDER_DAYS_AHEAD * DAY_MS);
  const windowEnd = new Date(now + (REMINDER_DAYS_AHEAD + 1) * DAY_MS);

  const rows = await db
    .select({
      id: schema.subscriptions.id,
      userId: schema.subscriptions.userId,
      plan: schema.subscriptions.plan,
      seats: schema.subscriptions.seats,
      currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
      email: schema.users.email,
    })
    .from(schema.subscriptions)
    .innerJoin(schema.users, eq(schema.users.id, schema.subscriptions.userId))
    .where(
      and(
        eq(schema.subscriptions.status, "active"),
        isNotNull(schema.subscriptions.currentPeriodEnd),
        gte(schema.subscriptions.currentPeriodEnd, windowStart),
        lt(schema.subscriptions.currentPeriodEnd, windowEnd),
      ),
    );

  let sent = 0;
  let deduplicated = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.currentPeriodEnd) continue; // satisfied by isNotNull above, narrow the type
    const renewalDate = row.currentPeriodEnd.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const planLabel =
      row.plan === "team" ? `Team (${row.seats} seats)` : "Pro";
    const amountLabel = PRICE_LABEL[row.plan] ?? "your subscription amount";

    // Dedupe by (subscription, renewal-date). If Stripe moves the
    // period-end (proration, retry), a new key fires once.
    const periodKey = row.currentPeriodEnd
      .toISOString()
      .slice(0, 10);
    const dedupeKey = `renewal_reminder:${row.id}:${periodKey}`;

    try {
      const result = await sendEmail({
        to: row.email,
        subject: `Your ContentRX subscription renews on ${renewalDate}`,
        react: RenewalReminderEmail({
          appUrl: appUrl(),
          planLabel,
          renewalDate,
          amountLabel,
        }),
        dedupeKey,
      });
      if (result.deduplicated) {
        deduplicated += 1;
      } else if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      logSafeError("renewal-reminder send failed", err);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    sent,
    deduplicated,
    failed,
  });
}
