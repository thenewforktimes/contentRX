import { Heading, Section, Text } from "@react-email/components";
import { EmailShell } from "./_shell";

/**
 * Founder alert when the end-of-month stripe-overage-meter cron
 * encountered one or more push failures.
 *
 * Triggered by /api/cron/stripe-overage-meter when `errored > 0`. A
 * single user-month failing means Stripe doesn't have the line item
 * for that user — they get under-billed unless we re-run / patch
 * manually. The alert exists so Robo notices within the same UTC day
 * instead of finding out at month-end reconciliation.
 *
 * The cron's Redis-based dedupe keeps re-runs from double-billing
 * users who DID push successfully; the `error` rows just need
 * targeted re-attempts. A typical playbook: open Vercel logs for the
 * cron run, identify the failing userId(s), patch root cause (Stripe
 * customer mapping, bad event_name, overage rate config), POST the
 * cron again — it'll skip the already-pushed rows via dedupe and
 * push only the previously-errored ones.
 */
export function OverageMeterFailureAlertEmail({
  closingMonth,
  errored,
  pushed,
  failures,
  appUrl,
}: {
  closingMonth: string;
  errored: number;
  pushed: number;
  failures: Array<{
    userId: string;
    overageChecks: number;
    error: string;
  }>;
  appUrl: string;
}) {
  return (
    <EmailShell
      preview={`Overage meter: ${errored} user-month push failure${errored === 1 ? "" : "s"} for ${closingMonth}`}
    >
      <Heading as="h1" style={{ fontSize: 18, marginBottom: 12 }}>
        Stripe overage meter: {errored} push failure
        {errored === 1 ? "" : "s"} for {closingMonth}
      </Heading>
      <Text>
        The end-of-month overage meter cron failed to push usage events
        for {errored} user-month{errored === 1 ? "" : "s"}.{" "}
        {pushed > 0
          ? `${pushed} other event${pushed === 1 ? " did" : "s did"} push successfully.`
          : "No events pushed."}{" "}
        Affected users will be under-billed on the next invoice unless
        the failures are re-attempted before the period closes on
        Stripe&apos;s side.
      </Text>
      {failures.slice(0, 10).map((f) => (
        <Section key={f.userId} style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: 600, margin: 0 }}>
            user_id={f.userId} &middot; {f.overageChecks} overage check
            {f.overageChecks === 1 ? "" : "s"}
          </Text>
          <Text style={{ margin: 0, fontSize: 13 }}>{f.error}</Text>
        </Section>
      ))}
      {failures.length > 10 && (
        <Text style={{ marginTop: 8, fontSize: 13 }}>
          + {failures.length - 10} more in the cron response payload.
        </Text>
      )}
      <Section style={{ marginTop: 20 }}>
        <Text>
          Open <a href={`${appUrl}/admin/costs/margin`}>{appUrl}/admin/costs/margin</a>{" "}
          to inspect the per-user overage state, then re-POST the cron
          once the underlying cause is fixed. Redis dedupe will skip
          rows already pushed.
        </Text>
      </Section>
    </EmailShell>
  );
}
