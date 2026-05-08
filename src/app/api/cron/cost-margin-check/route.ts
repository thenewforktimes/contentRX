/**
 * GET/POST /api/cron/cost-margin-check — daily margin alert.
 *
 * Phase 2 of the post-Phase-1 build (per _private/pricing-analysis.md).
 * Runs the per-plan rollup over a 7-day window. If any paid plan's
 * margin drops below the threshold (default 30%), emails the founder.
 * No-op when every paid plan is healthy — silent on green days so the
 * inbox doesn't get noisy.
 *
 * Cron wiring (add when enabling):
 *   // vercel.json
 *   "crons": [
 *     { "path": "/api/cron/cost-margin-check", "schedule": "0 9 * * *" }
 *   ]
 * Daily at 09:00 UTC. Vercel Cron passes
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * Idempotency: the email send uses a `cost-margin-alert:{YYYY-MM-DD}`
 * dedupe key in Redis, so re-running the cron the same day won't
 * double-send. If the alert state changes within a day (e.g., a plan
 * dips below threshold mid-morning then recovers), the dedupe still
 * holds — we'd rather under-fire than spam.
 */

import { NextResponse } from "next/server";
import { CostMarginAlertEmail } from "@/emails/cost-margin-alert";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  getCostMarginRollup,
  plansBelowMarginThreshold,
} from "@/lib/cost-margin-rollup";
import { appUrl, sendEmail } from "@/lib/email";
import { logSafeError } from "@/lib/safe-error-log";

const ALERT_THRESHOLD_PCT = 30;
const WINDOW_DAYS = 7;

interface RunResult {
  ok: true;
  windowDays: number;
  thresholdPct: number;
  plansEvaluated: number;
  alertsTriggered: number;
  emailSent: boolean;
  emailDeduplicated?: boolean;
}

async function run(): Promise<RunResult> {
  const rollup = await getCostMarginRollup({ windowDays: WINDOW_DAYS });
  const breaches = plansBelowMarginThreshold(rollup, ALERT_THRESHOLD_PCT);

  if (breaches.length === 0) {
    return {
      ok: true,
      windowDays: rollup.windowDays,
      thresholdPct: ALERT_THRESHOLD_PCT,
      plansEvaluated: rollup.plans.length,
      alertsTriggered: 0,
      emailSent: false,
    };
  }

  const founderEmail = process.env.FOUNDER_EMAIL ?? "hello@contentrx.io";
  const today = new Date().toISOString().slice(0, 10);
  const breachList = breaches.map((b) => b.plan).join(", ");

  let emailSent = false;
  let emailDeduplicated = false;
  try {
    const result = await sendEmail({
      to: founderEmail,
      subject: `Margin alert: ${breachList} below ${ALERT_THRESHOLD_PCT}% (${WINDOW_DAYS}d)`,
      react: CostMarginAlertEmail({
        thresholdPct: ALERT_THRESHOLD_PCT,
        windowDays: WINDOW_DAYS,
        breaches: breaches.map((b) => ({
          plan: b.plan,
          marginPct: b.marginPct ?? 0,
          checkCount: b.checkCount,
          avgCostPerUnitUsd: b.avgCostPerUnitUsd,
          perUnitRevenueUsd: b.perUnitRevenueUsd,
        })),
        appUrl: appUrl(),
      }),
      dedupeKey: `cost-margin-alert:${today}`,
    });
    emailSent = result.ok && !result.deduplicated;
    emailDeduplicated = !!result.deduplicated;
  } catch (err) {
    logSafeError("cost-margin alert email failed", err);
  }

  return {
    ok: true,
    windowDays: rollup.windowDays,
    thresholdPct: ALERT_THRESHOLD_PCT,
    plansEvaluated: rollup.plans.length,
    alertsTriggered: breaches.length,
    emailSent,
    ...(emailDeduplicated ? { emailDeduplicated: true } : {}),
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;
  return NextResponse.json(await run());
}

// Vercel Cron uses GET. Manual trigger from a browser would also use
// GET — we still require the bearer token, so a saved-curl probe
// can't fire the alert without the secret.
export async function GET(req: Request): Promise<NextResponse> {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;
  return NextResponse.json(await run());
}
