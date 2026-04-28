/**
 * GET /api/status — JSON health check for uptime monitors.
 *
 * Returns a typed shape with one entry per probed dependency.
 * 200 when everything's OK; 503 when any probe fails — uptime monitors
 * key on the status code, the body explains *what* failed for humans
 * tailing the dashboard.
 *
 * No auth — health endpoints are deliberately public so probes from
 * Better Stack, UptimeRobot, etc. work without juggling secrets. The
 * response contains no PII and no internal config; the only signal it
 * leaks is "is ContentRX up", which a probe can already infer from
 * any other endpoint timing out.
 *
 * Cache: never. Stale status is worse than no status.
 */

import { NextResponse } from "next/server";
import { gatherStatus } from "@/lib/status-checks";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await gatherStatus();
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
