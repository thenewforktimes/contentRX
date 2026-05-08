import { Heading, Section, Text } from "@react-email/components";
import { EmailShell } from "./_shell";

/**
 * Founder alert when any paid plan's 7-day rolling margin drops below
 * the threshold (default 30% per Phase 2 of the post-Phase-1 build).
 * Triggered by the daily cron at /api/cron/cost-margin-check.
 *
 * The cron computes margin via getCostMarginRollup() in
 * src/lib/cost-margin-rollup.ts and only sends if at least one paid
 * plan crosses the threshold. No noise on healthy days.
 */
export function CostMarginAlertEmail({
  thresholdPct,
  windowDays,
  breaches,
  appUrl,
}: {
  thresholdPct: number;
  windowDays: number;
  breaches: Array<{
    plan: string;
    marginPct: number;
    checkCount: number;
    avgCostPerUnitUsd: number;
    perUnitRevenueUsd: number;
  }>;
  appUrl: string;
}) {
  const planList = breaches.map((b) => b.plan).join(", ");
  return (
    <EmailShell
      preview={`Margin alert: ${planList} below ${thresholdPct}% over ${windowDays}d`}
    >
      <Heading as="h1" style={{ fontSize: 18, marginBottom: 12 }}>
        Margin below {thresholdPct}% on {breaches.length} plan
        {breaches.length === 1 ? "" : "s"}
      </Heading>
      <Text>
        Over the last {windowDays} days, the per-unit margin on the
        following paid plans dropped below {thresholdPct}%:
      </Text>
      {breaches.map((b) => (
        <Section key={b.plan} style={{ marginTop: 16 }}>
          <Text style={{ fontWeight: 600, margin: 0 }}>
            {b.plan} &middot; {b.marginPct.toFixed(0)}% margin
          </Text>
          <Text style={{ margin: 0 }}>
            ${b.avgCostPerUnitUsd.toFixed(4)} cost per unit on $
            {b.perUnitRevenueUsd.toFixed(4)} revenue. {b.checkCount}{" "}
            checks in the window.
          </Text>
        </Section>
      ))}
      <Section style={{ marginTop: 20 }}>
        <Text>
          Open <a href={`${appUrl}/admin/costs/margin`}>{appUrl}/admin/costs/margin</a>{" "}
          for the full per-plan rollup. Cross-reference Anthropic
          billing for invoice-grade numbers if the gap looks large.
        </Text>
      </Section>
    </EmailShell>
  );
}
